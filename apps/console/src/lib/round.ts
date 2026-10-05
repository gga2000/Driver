import type { FinanceDeskView, RoundStop } from '@driver/contracts';

/**
 * S-K5 · the 23:00 cash round in "round mode" (UI/UX audit merchant-and-console §8): the progress line
 * ("جمعنا 612,000 من 746,710 دينار"), each courier's state on his stop, the receipt form's checks and
 * the printed route. Pure; every number comes from the finance desk (the ledger), none is computed
 * into money here.
 */

type Round = FinanceDeskView['round'];
type RoundCourier = RoundStop['couriers'][number];

export interface RoundProgress {
  collectedIqd: number;
  targetIqd: number;
  leftIqd: number;
  /** 0–100 for the bar. */
  pct: number;
  /** Couriers still holding cash. */
  couriersLeft: number;
  done: boolean;
}

export function roundProgress(r: Pick<Round, 'stops' | 'totalIqd' | 'collectedIqd' | 'targetIqd'>): RoundProgress {
  const collectedIqd = r.collectedIqd ?? 0;
  const targetIqd = r.targetIqd ?? r.totalIqd + collectedIqd;
  const couriersLeft = r.stops.reduce((n, s) => n + s.couriers.filter((c) => c.heldIqd > 0).length, 0);
  return {
    collectedIqd,
    targetIqd,
    leftIqd: r.totalIqd,
    pct: targetIqd > 0 ? Math.min(100, Math.round((collectedIqd / targetIqd) * 100)) : 0,
    couriersLeft,
    done: r.totalIqd === 0 && collectedIqd > 0,
  };
}

/** `collected` — taken and nothing left on him; `partial` — taken, still holds some; `holding` — not yet. */
export function courierRoundState(c: Pick<RoundCourier, 'heldIqd' | 'collected'>): 'collected' | 'partial' | 'holding' {
  if (c.collected && c.heldIqd <= 0) return 'collected';
  if (c.collected) return 'partial';
  return 'holding';
}

/** A stop is done when nobody on it holds cash any more (and someone was collected there). */
export function stopDone(s: Pick<RoundStop, 'couriers'>): boolean {
  return s.couriers.length > 0 && s.couriers.every((c) => c.heldIqd <= 0);
}

/** The courier's daily code: 4 Western digits (Eastern digits typed on an Arabic keyboard are folded). */
export function normalizeCode(raw: string): string {
  return raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '').slice(0, 4);
}

export function codeValid(code: string): boolean {
  return /^\d{4}$/.test(code);
}

/** The amount field: whole dinars, more than 0, not more than he holds (the server checks it too). */
export function collectAmountProblem(amountIqd: number, heldIqd: number): 'empty' | 'too_much' | null {
  if (!Number.isFinite(amountIqd) || amountIqd <= 0) return 'empty';
  if (amountIqd > heldIqd) return 'too_much';
  return null;
}

/** Field input "34,900" / "٣٤٩٠٠" → 34900. */
export function parseAmount(raw: string): number {
  const digits = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export interface PrintRow {
  seq: number;
  zone: string;
  /** First row of a stop carries the stop; the rest leave it blank. */
  firstOfStop: boolean;
  driverId: string;
  name: string | null;
  heldIqd: number;
  overCap: boolean;
  collected: boolean;
}

/** The printed route: one line per courier in stop order, still-holding first inside each stop. */
export function printRows(r: Pick<Round, 'stops'>): PrintRow[] {
  const out: PrintRow[] = [];
  for (const s of r.stops) {
    const list = [...s.couriers].sort((a, b) => Number(b.heldIqd > 0) - Number(a.heldIqd > 0) || b.heldIqd - a.heldIqd);
    list.forEach((c, i) => out.push({ seq: s.seq, zone: s.zone_ar, firstOfStop: i === 0, driverId: c.driverId, name: c.name, heldIqd: c.heldIqd, overCap: c.overCap, collected: courierRoundState(c) === 'collected' }));
  }
  return out;
}

/** A retry key per opened receipt form: a double click or a retry posts once (ops.recordCashReceipt). */
export function receiptKey(driverId: string, openedAt: number, rand: () => number = Math.random): string {
  return `console-round:${driverId}:${openedAt.toString(36)}:${Math.floor(rand() * 1e9).toString(36)}`;
}
