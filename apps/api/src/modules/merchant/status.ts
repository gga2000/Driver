import { MERCHANT_BUSY_RULES, type EarlyCloseReason, type StoreStatusView } from '@driver/contracts';

/** The slice of a store's settings the status header is built from (orgs `MerchantSettings`). */
export interface StatusFacts {
  merchantOrgId: string;
  name: string;
  now: Date;
  busyUntil: Date | null;
  closed: { reason: string; note: string | null; at: Date } | null;
  printer: { state: 'connected' | 'disconnected'; name: string | null; at: Date } | null;
  /** The pause window in force now (Friday prayer), if any. */
  pause: { reason?: string | undefined; end: string } | null;
  lastHeartbeatAt: Date | null;
  defaultPrepMinutes: number;
  /** The weekly schedule and holidays at `now` (absent: not computed). */
  schedule?: StoreStatusView['schedule'];
}

const REASONS: ReadonlySet<string> = new Set<EarlyCloseReason>(['sold_out', 'too_busy', 'no_staff', 'power_cut', 'closing_early', 'other']);

/** Busy until: now + 60 min when switched on, null when off. */
export function busyUntilFor(on: boolean, now: Date): Date | null {
  return on ? new Date(now.getTime() + MERCHANT_BUSY_RULES.durationMinutes * 60_000) : null;
}

/** The status header. Busy mode past its hour reads as off (it expires by itself, no job needed). */
export function toStoreStatus(f: StatusFacts): StoreStatusView {
  const busyOn = f.busyUntil !== null && f.busyUntil.getTime() > f.now.getTime();
  const closed = f.closed ? { reason: (REASONS.has(f.closed.reason) ? f.closed.reason : 'other') as EarlyCloseReason, note: f.closed.note, at: f.closed.at } : null;
  return {
    merchantOrgId: f.merchantOrgId,
    name: f.name,
    now: f.now,
    open: closed === null && f.pause === null,
    closed,
    pause: f.pause ? { reason: f.pause.reason ?? null, until: f.pause.end } : null,
    busy: { on: busyOn, until: busyOn ? f.busyUntil : null, extraPrepMinutes: busyOn ? MERCHANT_BUSY_RULES.extraPrepMinutes : 0 },
    printer: f.printer ? { state: f.printer.state, name: f.printer.name, updatedAt: f.printer.at } : { state: 'not_set_up', name: null, updatedAt: null },
    lastHeartbeatAt: f.lastHeartbeatAt,
    defaultPrepMinutes: f.defaultPrepMinutes,
    ...(f.schedule !== undefined ? { schedule: f.schedule } : {}),
  };
}
