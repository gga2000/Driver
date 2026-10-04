import { partnerCurrentStop, type HandoverProof, type LatLng, type PartnerJob } from '@driver/contracts';

/**
 * Job taps that survive a dead network (P-09). "وصلت" and "سلّمت" (cash included) are evidence: they
 * must reach the server, in the order they were tapped, carrying the time the driver tapped them —
 * not the time the network came back.
 *
 * Every tap is stamped on the device (`occurredAt` wall time, `deviceUptimeMs` monotonic uptime and an
 * `idempotencyKey`). Online with nothing waiting, it is sent at once; offline, or behind earlier
 * waiting taps, it joins the queue (persisted, so it survives the app being killed) and the job
 * screen moves on locally with "محفوظ، يندز لما يرجع النت". On reconnect the queue replays strictly in
 * order, one at a time:
 *  - the server answers → drop it, next;
 *  - no response → stop, keep it and everything after it for the next try;
 *  - the server refuses (a real conflict) → drop it, tell the driver, carry on (later taps of the
 *    same stop would only conflict too, so they go with it).
 * The server makes replays safe (edge-case §10): arrive / completeStop are no-ops when already done, the
 * key dedupes the same action, evidence is bound to server receipt time with the device time on the
 * event, and a tap replayed after the order left his trip is quarantined as `late_replay`, never settled.
 */

export interface DeviceStamp {
  /** Device wall time of the tap (ISO; persisted as text). */
  occurredAt: string;
  /** Monotonic uptime at the tap (skew checks, late-replay detection). */
  deviceUptimeMs: number;
  idempotencyKey: string;
}

export type QueuedAction =
  | ({ kind: 'arrive'; tripId: string; stopId: string; pin?: LatLng } & DeviceStamp)
  | ({ kind: 'complete'; tripId: string; stopId: string; handover: HandoverProof } & DeviceStamp);

/** What the screen asks for, before the stamp. */
export type JobTap = { kind: 'arrive'; tripId: string; stopId: string; pin?: LatLng } | { kind: 'complete'; tripId: string; stopId: string; handover: HandoverProof };

export interface QueueStore {
  load(): Promise<string | null>;
  save(value: string | null): Promise<void>;
}

export interface QueueSender {
  /** Resolves with the server's answer; rejects with the tRPC error. */
  send(action: QueuedAction): Promise<unknown>;
}

export interface FlushResult {
  sent: QueuedAction[];
  rejected: Array<{ action: QueuedAction; error: unknown }>;
  /** The network failed mid-way: the rest is still waiting. */
  stalled: boolean;
}

export interface ActionQueue {
  items(): readonly QueuedAction[];
  sending(): boolean;
  subscribe(listener: () => void): () => void;
  hydrate(): Promise<void>;
  /** Appends a stamped tap and persists it. */
  enqueue(action: QueuedAction): Promise<void>;
  /** Replays in order until empty or the network fails again (single-flight). */
  flush(): Promise<FlushResult>;
  clear(): Promise<void>;
}

/** Most taps a phone keeps: a run is a handful of stops; anything beyond is a bug, not a backlog. */
export const MAX_QUEUED = 30;

export function createActionQueue(opts: { store: QueueStore; sender: QueueSender; isNetworkError(err: unknown): boolean }): ActionQueue {
  let list: QueuedAction[] = [];
  let inflight: Promise<FlushResult> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  const persist = () => opts.store.save(list.length ? JSON.stringify(list) : null);

  const run = async (): Promise<FlushResult> => {
    const result: FlushResult = { sent: [], rejected: [], stalled: false };
    while (list.length) {
      const head = list[0]!;
      try {
        await opts.sender.send(head);
        list = list.slice(1);
        result.sent.push(head);
      } catch (error) {
        if (opts.isNetworkError(error)) {
          result.stalled = true;
          break;
        }
        // Refused: drop it and the later taps of the same stop (they depend on it).
        const dropped = list.filter((a) => a === head || (a.tripId === head.tripId && a.stopId === head.stopId));
        list = list.filter((a) => !dropped.includes(a));
        for (const action of dropped) result.rejected.push({ action, error });
      }
      await persist();
      emit();
    }
    return result;
  };

  return {
    items: () => list,
    sending: () => inflight !== null,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    async hydrate() {
      const raw = await opts.store.load();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as QueuedAction[];
        if (Array.isArray(parsed)) {
          // Keep what was tapped before this load, then anything enqueued meanwhile.
          list = [...parsed.filter(isQueuedAction), ...list.filter((a) => !parsed.some((p) => p.idempotencyKey === a.idempotencyKey))];
          emit();
        }
      } catch {
        await opts.store.save(null);
      }
    },
    async enqueue(action) {
      if (list.some((a) => a.idempotencyKey === action.idempotencyKey)) return;
      list = [...list, action].slice(-MAX_QUEUED);
      await persist();
      emit();
    },
    flush() {
      if (inflight) return inflight;
      if (!list.length) return Promise.resolve({ sent: [], rejected: [], stalled: false });
      inflight = run().finally(() => {
        inflight = null;
        emit();
      });
      emit();
      return inflight;
    },
    async clear() {
      list = [];
      await persist();
      emit();
    },
  };
}

function isQueuedAction(a: unknown): a is QueuedAction {
  const o = a as Partial<QueuedAction> | null;
  return !!o && (o.kind === 'arrive' || o.kind === 'complete') && typeof o.tripId === 'string' && typeof o.stopId === 'string' && typeof o.idempotencyKey === 'string' && typeof o.occurredAt === 'string';
}

// ───────────────────────── stamps ─────────────────────────

let seq = 0;

/** Device evidence for one tap: wall time, monotonic uptime, and a key unique to this tap. */
export function stampTap(tap: JobTap, clock: { now(): number; uptime(): number } = defaultClock): QueuedAction {
  seq += 1;
  const now = clock.now();
  const key = `tap-${now.toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { ...tap, occurredAt: new Date(now).toISOString(), deviceUptimeMs: Math.max(0, Math.round(clock.uptime())), idempotencyKey: key } as QueuedAction;
}

const defaultClock = {
  now: () => Date.now(),
  uptime: () => (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0,
};

/** The procedure input a queued tap replays as (dates revived). */
export function toInput(a: QueuedAction) {
  const stamp = { occurredAt: new Date(a.occurredAt), deviceUptimeMs: a.deviceUptimeMs, idempotencyKey: a.idempotencyKey };
  return a.kind === 'arrive'
    ? { tripId: a.tripId, stopId: a.stopId, ...(a.pin ? { pin: a.pin } : {}), ...stamp }
    : { tripId: a.tripId, stopId: a.stopId, handover: a.handover, ...stamp };
}

// ───────────────────────── the job as the driver sees it ─────────────────────────

/**
 * The job with the waiting taps applied: arrived / completed stops, the next task current. `saved`
 * lists the stops whose state only this phone knows so far ("محفوظ").
 */
export function applyQueued(job: PartnerJob, queue: readonly QueuedAction[]): { job: PartnerJob; saved: ReadonlySet<string>; allDone: boolean } {
  const mine = queue.filter((a) => a.tripId === job.tripId);
  if (!mine.length) return { job, saved: new Set(), allDone: false };
  const saved = new Set<string>();
  const stops = job.stops.map((s) => {
    let next = s;
    for (const a of mine) {
      if (a.stopId !== s.stopId) continue;
      if (a.kind === 'arrive' && next.state === 'pending') {
        next = { ...next, state: 'arrived', arrivedAt: new Date(a.occurredAt) };
        saved.add(s.stopId);
      } else if (a.kind === 'complete' && (next.state === 'arrived' || next.state === 'pending')) {
        next = { ...next, state: 'completed', completedAt: new Date(a.occurredAt) };
        saved.add(s.stopId);
      }
    }
    return next;
  });
  const current = partnerCurrentStop(stops);
  return { job: { ...job, stops, currentStopId: current?.stopId ?? null }, saved, allDone: current === null };
}
