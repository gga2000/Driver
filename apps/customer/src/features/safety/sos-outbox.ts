import type { SosPosition, SosSubject, SosView } from '@driver/contracts';

/**
 * The SOS press that hasn't reached the server yet (audit FLOW-05). It lives outside any screen or
 * sheet: closing the sheet or leaving the trip screen never stops it. It is retried every few seconds,
 * at once when the network comes back or the app returns to the foreground, until the server answers.
 * Every attempt keeps the press's client id, so the server sees one incident however many tries it
 * takes. Free of React Native so it runs in plain Node tests.
 */

export interface SosPress {
  clientId: string;
  pressedAt: Date;
  subject: SosSubject;
}

export interface SosOutboxState {
  press: SosPress | null;
  /** How the last attempt failed: no network, or the server (or a timeout) said no. */
  failure: 'offline' | 'failed' | null;
  /** The incident the server opened for the last press that got through. */
  delivered: { subjectKey: string; view: SosView } | null;
}

export interface SosOutboxDeps {
  send(input: { subject: SosSubject; position: SosPosition | null; clientId: string; pressedAt: Date }): Promise<SosView>;
  fix(): Promise<SosPosition | null>;
  online(): boolean;
}

interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}
const realTimers: Timers = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export const SOS_RETRY_MS = 4_000;
export const subjectKey = (s: SosSubject) => `${s.kind}:${s.id}`;
const newClientId = () => `sos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function createSosOutbox(opts: { timers?: Timers; retryMs?: number; newId?: () => string } = {}) {
  const timers = opts.timers ?? realTimers;
  const retryMs = opts.retryMs ?? SOS_RETRY_MS;
  const newId = opts.newId ?? newClientId;
  let deps: SosOutboxDeps | null = null;
  let state: SosOutboxState = { press: null, failure: null, delivered: null };
  let timer: unknown = null;
  let sending = false;
  const listeners = new Set<() => void>();

  const set = (next: Partial<SosOutboxState>) => {
    state = { ...state, ...next };
    for (const l of [...listeners]) l();
  };
  const schedule = () => {
    if (timer !== null) timers.clearTimeout(timer);
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
      const position = await d.fix().catch(() => null);
      const view = await d.send({ subject: press.subject, position, clientId: press.clientId, pressedAt: press.pressedAt });
      if (state.press !== press) return;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      set({ press: null, failure: null, delivered: { subjectKey: subjectKey(press.subject), view } });
    } catch {
      if (state.press !== press) return;
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
    },
    /** A completed 3-second hold: a new press, sent now. */
    press(subject: SosSubject): SosPress {
      const p: SosPress = { clientId: newId(), pressedAt: new Date(), subject };
      set({ press: p, failure: null, delivered: null });
      void attempt();
      return p;
    },
    /** Try now (the retry button, the network back, the app in the foreground). */
    nudge() {
      if (!state.press) return;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      void attempt();
    },
    pendingFor(subject: SosSubject | null): boolean {
      return Boolean(subject && state.press && subjectKey(state.press.subject) === subjectKey(subject));
    },
  };
}

export type SosOutbox = ReturnType<typeof createSosOutbox>;
