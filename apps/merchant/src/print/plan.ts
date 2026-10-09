import type { BoardLine, BoardOrder } from '@driver/contracts';
import type { PrintDoc, PrintJob } from './doc';
import type { PrintCtx } from './context';
import { buildChangeTicket, buildCupLabels, buildKitchenTicket, buildStationTickets, snapLines, type LineSnap, type Station } from './kitchen';
import { paperSpec } from './paper';
import { cupsOn, type PrintSettings } from './settings';
import { buildCustomerSlip } from './slip';

/**
 * Which papers an order prints, and when (print redesign, Ali 2026-10-08). One trip to the printer:
 * the kitchen ticket with its bag stub (or, with stations on, a ticket per station and a packing
 * ticket), extra kitchen copies, cup labels for drinks, then the customer slip — a cut after each.
 */

export interface PlanInput {
  order: BoardOrder;
  ctx: Omit<PrintCtx, 'paper'>;
  settings: PrintSettings;
  /** The store's prep kind: a drinks shop gets cup labels by default. */
  prepKind?: 'food' | 'drinks';
  /** Menu item names → their section, for stations and cups (the shop's own menu). */
  sectionOf?: (dishName: string) => string | null;
  /** The earlier print of this order on this device, if any (i13). */
  previous?: { count: number; firstAt: number } | null;
}

export function stationOfLine(settings: PrintSettings, sectionOf: PlanInput['sectionOf']): (l: BoardLine) => Station {
  const drinks = new Set(settings.drinkSections);
  return (l) => {
    const section = sectionOf?.(l.name) ?? null;
    return section && drinks.has(section) ? 'drinks' : 'kitchen';
  };
}

export function planOrderJob({ order: o, ctx: base, settings, prepKind, sectionOf, previous }: PlanInput): PrintJob {
  const ctx: PrintCtx = { ...base, paper: paperSpec(settings.dots) };
  const reprint = previous ? { firstAt: new Date(previous.firstAt), copy: previous.count + 1 } : null;
  const opts = { reprint, stub: settings.stub, itemsPerBag: settings.itemsPerBag };
  const station = stationOfLine(settings, sectionOf);
  const docs: PrintDoc[] = [];
  const split = settings.stations && settings.drinkSections.length ? buildStationTickets(o, ctx, station, opts) : null;
  if (split) docs.push(...split);
  else {
    const kitchen = buildKitchenTicket(o, ctx, opts);
    docs.push(kitchen);
    // A second kitchen copy carries no stub: there is one bag.
    if (settings.copies === 2 && !reprint) docs.push(buildKitchenTicket(o, ctx, { ...opts, stub: false }));
  }
  if (cupsOn(settings, prepKind) && !reprint) {
    const drinkOnly = prepKind === 'drinks' && !settings.drinkSections.length;
    const cups = buildCupLabels(o, ctx, drinkOnly ? () => true : (l) => station(l) === 'drinks');
    if (cups) docs.push(cups);
  }
  if (settings.slip) docs.push(buildCustomerSlip(o, ctx));
  return { orderId: o.id, number: o.number, docs, beep: settings.beep && !reprint, cut: settings.cut };
}

/** The short «تعديل» ticket when dishes changed since this device printed the order (i14). */
export function planChangeJob(o: BoardOrder, before: readonly LineSnap[], base: Omit<PrintCtx, 'paper'>, settings: PrintSettings): PrintJob | null {
  const doc = buildChangeTicket(o, before, { ...base, paper: paperSpec(settings.dots) });
  return doc ? { orderId: o.id, number: o.number, docs: [doc], beep: settings.beep, cut: settings.cut } : null;
}

/** Minutes before the ready time a scheduled order starts cooking when the board gives no prep time. */
export const SCHEDULED_LEAD_MIN = 20;

/**
 * When an accepted order may print by itself:
 * - `wait`: a partial accept still waiting for the customer (i16) — it prints once he answers;
 * - `at`: a scheduled order prints at its start-cooking time with the «مجدول» band (i17);
 * - `now`: everything else.
 */
export function autoPrintWhen(o: BoardOrder, now: number): { kind: 'now' } | { kind: 'wait' } | { kind: 'at'; at: number } {
  if (o.partial) return { kind: 'wait' };
  if (o.column === 'new') return { kind: 'wait' };
  if (o.scheduledFor) {
    const ready = (o.promisedReadyAt ?? o.scheduledFor).getTime();
    const start = ready - (o.prepMinutes ?? SCHEDULED_LEAD_MIN) * 60_000;
    if (start > now) return { kind: 'at', at: start };
  }
  return { kind: 'now' };
}

export { snapLines };
