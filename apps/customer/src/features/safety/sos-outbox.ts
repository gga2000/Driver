import { classifyError } from '@driver/contracts/net-client';
import { SosPosition, type SosSubject, type SosView } from '@driver/contracts';
import type { KeyValueStorage } from '@/lib/storage';

/**
 * The SOS press that hasn't reached the server yet (audit FLOW-05). It lives outside any screen or
 * sheet: closing the sheet or leaving the trip screen never stops it. It is retried every few seconds,
 * at once when the network comes back or the app returns to the foreground, until the server answers.
 * Every attempt keeps the press's client id, so the server sees one incident however many tries it
 * takes. It is saved on the phone while it waits, so a press made offline survives the app being
 * killed and is sent on the next launch. Only a failure a retry can fix is retried: a definitive
 * refusal ends it and the person is sent to the police number. Free of React Native so it runs in
 * plain Node tests.
 */

export interface SosPress {
  clientId: string;
  pressedAt: Date;
  subject: SosSubject;
  /** The last fix the phone gave for this press, sent again when a later try has none. */
  position: SosPosition | null;
  /** Read back from the phone at launch (the app was closed while it waited). */
  restored: boolean;
}

export interface SosOutboxState {
  press: SosPress | null;
  /** How the last attempt failed: no network, or the server (or a timeout) failed for now. */
  failure: 'offline' | 'failed' | null;
  /** The incident the server opened for the last press that got through. */
  delivered: { subjectKey: string; view: SosView; restored: boolean } | null;
  /** The last press the server refused for good: the person must call the police number. */
  refused: { subjectKey: string; restored: boolean } | null;
}

export interface SosOutboxDeps {
  send(input: { subject: SosSubject; position: SosPosition | null; clientId: string; pressedAt: Date }): Promise<SosView>;
  fix(): Promise<SosPosition | null>;
  online(): boolean;
  /**
   * Whether this phone still holds a session. A 401 while it does is a refresh that hasn't got
   * through yet (a weak network), so the press is retried; only a 401 with the session gone is final.
   */
  signedIn?(): boolean;
}

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}
const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export const SOS_RETRY_MS = 4_000;
/** A saved press older than this at launch is not sent: the moment has passed (the person is told). */
export const SOS_RESEND_MAX_AGE_MS = 30 * 60_000;
export const SOS_PENDING_KEY = 'driver.customer.sos_pending';
export const subjectKey = (s: SosSubject) => `${s.kind}:${s.id}`;
const newClientId = () => `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface SavedPress {
  clientId: string;
  pressedAt: string;
  subject: SosSubject;
  position: SosPosition | null;
}

function readSaved(raw: string | null): SavedPress | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<SavedPress>;
    const s = p.subject as Partial<SosSubject> | undefined;
    if (typeof p.clientId !== 'string' || typeof p.pressedAt !== 'string' || !s || typeof s.kind !== 'string' || typeof s.id !== 'string') return null;
    if (Number.isNaN(Date.parse(p.pressedAt))) return null;
    const position = SosPosition.safeParse(p.position);
    return { clientId: p.clientId, pressedAt: p.pressedAt, subject: s as SosSubject, position: position.success ? position.data : null };
  } catch {
    return null;
  }
}

export function createSosOutbox(opts: { timers?: Timers; retryMs?: number; newId?: () => string; storage?: KeyValueStorage; now?: () => number } = {}) {
  const timers = opts.timers ?? realTimers;
  const retryMs = opts.retryMs ?? SOS_RETRY_MS;
  const newId = opts.newId ?? newClientId;
  const now = opts.now ?? (() => Date.now());
  const store = opts.storage ?? null;
  let deps: SosOutboxDeps | null = null;
  let state: SosOutboxState = { press: null, failure: null, delivered: null, refused: null };
  let timer: unknown = null;
  let sending = false;
  let restoring: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: Partial<SosOutboxState>) => {
    state = { ...state, ...next };
    for (const l of [...listeners]) l();
  };
  const save = (p: SosPress | null) => {
    if (!store) return;
    const write = p
      ? store.setItem(SOS_PENDING_KEY, JSON.stringify({ clientId: p.clientId, pressedAt: p.pressedAt.toISOString(), subject: p.subject, position: p.position } satisfies SavedPress))
      : store.removeItem(SOS_PENDING_KEY);
    void write.catch(() => undefined);
  };
  const clearTimer = () => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
  };
  const schedule = () => {
    clearTimer();
    timer = timers.setTimeout(() => {
      timer = null;
      void attempt();
    }, retryMs);
  };

  async function attempt(): Promise<void> {
    const press = state.press;
    if (!press || !deps || sending) return;
    sending = true;
    const d = deps;
    try {
      const fix = await d.fix().catch(() => null);
      if (fix && state.press === press) {
        press.position = fix;
        save(press);
      }
      const view = await d.send({ subject: press.subject, position: fix ?? press.position, clientId: press.clientId, pressedAt: press.pressedAt });
      if (state.press !== press) return;
      clearTimer();
      save(null);
      set({ press: null, failure: null, delivered: { subjectKey: subjectKey(press.subject), view, restored: press.restored } });
    } catch (err) {
      if (state.press !== press) return;
      const c = classifyError(err);
      if (!c.transient && !(c.kind === 'auth' && d.signedIn?.())) {
        // A definitive answer (refused, not found, invalid): retrying can't help, so stop and say "call 911".
        clearTimer();
        save(null);
        set({ press: null, failure: null, refused: { subjectKey: subjectKey(press.subject), restored: press.restored } });
        return;
      }
      set({ failure: d.online() ? 'failed' : 'offline' });
      schedule();
    } finally {
      sending = false;
    }
  }

  return {
    getState: (): SosOutboxState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** The app's sender (the API client, the phone's fix); the latest one is used for every retry. */
    setDeps(next: SosOutboxDeps) {
      deps = next;
      if (state.press && !sending && timer === null) void attempt();
    },
    /**
     * At launch: a press saved before the app was closed is sent again (same client id, so the server
     * keeps one incident). One too old to matter is dropped and reported as refused, so the person is
     * pointed to the police number instead of nothing.
     */
    restore(): Promise<void> {
      if (!store) return Promise.resolve();
      restoring ??= (async () => {
        const saved = readSaved(await store.getItem(SOS_PENDING_KEY).catch(() => null));
        if (!saved || state.press) return;
        if (now() - Date.parse(saved.pressedAt) > SOS_RESEND_MAX_AGE_MS) {
          save(null);
          set({ refused: { subjectKey: subjectKey(saved.subject), restored: true } });
          return;
        }
        set({ press: { clientId: saved.clientId, pressedAt: new Date(saved.pressedAt), subject: saved.subject, position: saved.position, restored: true }, failure: null });
        void attempt();
      })();
      return restoring;
    },
    /** A completed 3-second hold: a new press, saved and sent now. */
    press(subject: SosSubject): SosPress {
      const p: SosPress = { clientId: newId(), pressedAt: new Date(now()), subject, position: null, restored: false };
      clearTimer();
      save(p);
      set({ press: p, failure: null, delivered: null, refused: null });
      void attempt();
      return p;
    },
    /** Try now (the retry button, the network back, the app in the foreground). */
    nudge() {
      if (!state.press) return;
      clearTimer();
      void attempt();
    },
    pendingFor(subject: SosSubject | null): boolean {
      return Boolean(subject && state.press && subjectKey(state.press.subject) === subjectKey(subject));
    },
  };
}

export type SosOutbox = ReturnType<typeof createSosOutbox>;
