import { MERCHANT_BUSY_RULES, type EarlyCloseReason, type PrepKind, type StoreStatusView } from '@driver/contracts';

/** The slice of a store's settings the status header is built from (orgs `MerchantSettings`). */
export interface StatusFacts {
  merchantOrgId: string;
  name: string;
  now: Date;
  busyUntil: Date | null;
  /** The busy minutes picked when it was switched on (r5); null/absent = +10. */
  busyExtraMin?: number | null;
  /** The accept sheet's prep choices (t5); absent = food. */
  prepKind?: PrepKind;
  /** The hand close in force at `now` (already through `closedNow`). */
  closed: { reason: string; note: string | null; at: Date; until?: Date | null } | null;
  printer: { state: 'connected' | 'disconnected'; name: string | null; at: Date } | null;
  /** The pause window in force now (Friday prayer), if any. */
  pause: { reason?: string | undefined; end: string } | null;
  lastHeartbeatAt: Date | null;
  defaultPrepMinutes: number;
  /** The weekly schedule and holidays at `now` (absent: not computed). */
  schedule?: StoreStatusView['schedule'];
  /** «جهّز محلك» (absent/null: a shop from before setup). */
  setup?: StoreStatusView['setup'];
}

const REASONS: ReadonlySet<string> = new Set<EarlyCloseReason>(['sold_out', 'too_busy', 'no_staff', 'power_cut', 'closing_early', 'other']);

/** The busy minutes a switch-on stores (r5): only 10 or 20, else the default +10. */
export function busyExtraFor(picked: number | null | undefined): number {
  return (MERCHANT_BUSY_RULES.extraChoices as readonly number[]).includes(picked ?? -1) ? picked! : MERCHANT_BUSY_RULES.extraPrepMinutes;
}

/** Busy until: now + 60 min when switched on, null when off. */
export function busyUntilFor(on: boolean, now: Date): Date | null {
  return on ? new Date(now.getTime() + MERCHANT_BUSY_RULES.durationMinutes * 60_000) : null;
}

/** The status header. Busy mode past its hour reads as off (it expires by itself, no job needed). */
export function toStoreStatus(f: StatusFacts): StoreStatusView {
  const busyOn = f.busyUntil !== null && f.busyUntil.getTime() > f.now.getTime();
  const closed = f.closed ? { reason: (REASONS.has(f.closed.reason) ? f.closed.reason : 'other') as EarlyCloseReason, note: f.closed.note, at: f.closed.at, until: f.closed.until ?? null } : null;
  return {
    merchantOrgId: f.merchantOrgId,
    name: f.name,
    now: f.now,
    open: closed === null && f.pause === null,
    closed,
    pause: f.pause ? { reason: f.pause.reason ?? null, until: f.pause.end } : null,
    busy: { on: busyOn, until: busyOn ? f.busyUntil : null, extraPrepMinutes: busyOn ? busyExtraFor(f.busyExtraMin) : 0 },
    prepKind: f.prepKind ?? 'food',
    printer: f.printer ? { state: f.printer.state, name: f.printer.name, updatedAt: f.printer.at } : { state: 'not_set_up', name: null, updatedAt: null },
    lastHeartbeatAt: f.lastHeartbeatAt,
    defaultPrepMinutes: f.defaultPrepMinutes,
    ...(f.schedule !== undefined ? { schedule: f.schedule } : {}),
    ...(f.setup ? { setup: f.setup } : {}),
  };
}
