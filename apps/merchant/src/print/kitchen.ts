import type { BoardLine, BoardOrder } from '@driver/contracts';
import type { Block, PrintDoc, PrintItem } from './doc';
import { allergiesOf, amount, bareClock, clock, itemOf, items, periodWord, whoLabel, type PrintCtx } from './context';

/**
 * «الريل» — the kitchen ticket for the rail above the grill (print redesign, Ali 2026-10-08): the
 * number and ready time huge, allergies as a black band on top, the order note before the dishes,
 * no money (i08), and a tear-off stub for the bag with the pickup code and the cash. Also the short
 * «تعديل» ticket (i14), one ticket per station plus a packing ticket (i19) and café cup labels (i20).
 */

export interface KitchenOptions {
  /** A second (or later) print of the same order on this device (i13). */
  reprint?: { firstAt: Date; copy: number } | null;
  /** The tear-off bag stub (i09). */
  stub: boolean;
  /** How many dishes go in one bag, for «كيس 1 من 2» (i10). */
  itemsPerBag: number;
}

function head(ctx: PrintCtx, o: BoardOrder, withPeriod = true): Block {
  const ready = o.promisedReadyAt ?? o.scheduledFor;
  return {
    t: 'head',
    label: ctx.t('merchant.ticket.order'),
    number: o.number,
    ready: ready ? { label: ctx.t('merchant.ticket.ready'), time: bareClock(ctx, ready), period: withPeriod ? periodWord(ctx, ready) : '' } : null,
  };
}

function facts(ctx: PrintCtx, o: BoardOrder): Block {
  return { t: 'facts', parts: [ctx.t('merchant.ticket.delivery'), ctx.t('merchant.receipt.placed', { time: bareClock(ctx, o.placedAt) }), items(ctx, o.itemCount)] };
}

/** «نسخة ثانية» (i13), «مجدول» (i17), «طلب كبير» (i18): status bands, most important first. */
function bands(ctx: PrintCtx, o: BoardOrder, reprint: KitchenOptions['reprint']): Block[] {
  const out: Block[] = [];
  if (reprint) {
    out.push({
      t: 'band',
      title: reprint.copy <= 2 ? ctx.t('merchant.ticket.copy_second') : ctx.t('merchant.ticket.copy_n', { n: reprint.copy }),
      sub: ctx.t('merchant.ticket.copy_first_at', { time: clock(ctx, reprint.firstAt) }),
    });
  }
  if (o.scheduledFor) out.push({ t: 'band', title: ctx.t('merchant.ticket.scheduled'), sub: ctx.t('merchant.ticket.scheduled_for', { time: clock(ctx, o.scheduledFor) }) });
  if (o.catering) out.push({ t: 'band', title: ctx.t('merchant.ticket.big_order'), sub: items(ctx, o.itemCount) });
  return out;
}

function alerts(ctx: PrintCtx, o: BoardOrder, small = false): Block[] {
  return allergiesOf(ctx, o).map((a) => ({ t: 'alert' as const, title: a.text, ...(a.where ? { sub: a.where } : {}), ...(small ? { small } : {}) }));
}

function outSub(ctx: PrintCtx, o: BoardOrder, l: BoardLine): string {
  if (l.availability === 'removed') return ctx.t('merchant.ticket.out_agreed');
  return o.partial ? ctx.t('merchant.ticket.out_waiting') : ctx.t('merchant.ticket.out');
}

/** The tear line and one stub per bag (i09–i12). */
export function stubBlocks(ctx: PrintCtx, o: BoardOrder, itemsPerBag: number): Block[] {
  const bags = Math.max(1, Math.ceil(o.itemCount / Math.max(1, itemsPerBag)));
  const hidden = Boolean(o.gift?.hidePrices);
  const cash = o.paymentMethod === 'cash' && o.collectCashIqd > 0 && !hidden;
  const out: Block[] = [];
  for (let bag = 1; bag <= bags; bag += 1) {
    out.push({ t: 'tear', text: ctx.t('merchant.ticket.tear') });
    out.push({
      t: 'stub',
      numberLabel: ctx.t('merchant.ticket.order'),
      number: o.number,
      code: { label: ctx.t('merchant.ticket.pickup_code'), value: o.courier.pickupCode ?? null, blank: ctx.t('merchant.ticket.pickup_code_blank') },
      money: cash ? { kind: 'cash', label: ctx.t('merchant.ticket.cash'), amount: amount(o.collectCashIqd), unit: ctx.t('merchant.ticket.dinar') } : { kind: 'paid', text: ctx.t('merchant.ticket.paid') },
      items: items(ctx, o.itemCount),
      bag: ctx.t('merchant.ticket.bag', { n: bag, of: bags }),
      ...(o.courier.firstName ? { courier: ctx.t('merchant.ticket.courier', { name: o.courier.firstName }) } : {}),
    });
  }
  return out;
}

export function foot(ctx: PrintCtx, start?: string): Block {
  return { t: 'foot', start: start ?? ctx.t('merchant.ticket.printed_at', { time: clock(ctx, ctx.now) }), end: ctx.t('merchant.receipt.footer'), wordmark: true };
}

/** The dishes, by person, with run-out ones taken out into a «شيل من الطلب» box (i15). */
function dishes(ctx: PrintCtx, o: BoardOrder, keep: (l: BoardLine) => boolean = () => true): Block[] {
  const out: Block[] = [];
  const gone: PrintItem[] = [];
  const several = o.groups.length > 1;
  for (const g of o.groups) {
    const lines = g.lines.filter(keep);
    const cook = lines.filter((l) => l.availability === 'available');
    for (const l of lines) if (l.availability !== 'available') gone.push({ qty: l.qty, name: l.name, mods: [], sub: outSub(ctx, o, l) });
    if (cook.length === 0) continue;
    if (several || g.kind === 'participant') {
      const note = g.note && !allergiesOf(ctx, { note: null, groups: [{ ...g, lines: [] }] }).length ? g.note : undefined;
      out.push({ t: 'who', label: whoLabel(ctx, g), count: cook.reduce((a, l) => a + l.qty, 0), ...(note ? { note } : {}) });
    }
    for (const l of cook) out.push({ t: 'item', ...itemOf(l) });
  }
  if (gone.length) out.push({ t: 'box', tone: 'out', title: ctx.t('merchant.ticket.take_out'), items: gone });
  return out;
}

function orderNote(ctx: PrintCtx, o: BoardOrder): Block[] {
  // An allergy in the order note is already the black band; anything else sits above the dishes (i07).
  if (!o.note || allergiesOf(ctx, { note: o.note, groups: [] }).length) return [];
  return [{ t: 'note', label: ctx.t('merchant.ticket.order_note'), text: o.note }];
}

export function buildKitchenTicket(o: BoardOrder, ctx: PrintCtx, opts: KitchenOptions): PrintDoc {
  const blocks: Block[] = [
    ...bands(ctx, o, opts.reprint),
    head(ctx, o),
    facts(ctx, o),
    ...alerts(ctx, o),
    ...orderNote(ctx, o),
    ...dishes(ctx, o),
    { t: 'count', text: ctx.t('merchant.ticket.in_bag', { count: o.itemCount }) },
    ...(opts.stub ? stubBlocks(ctx, o, opts.itemsPerBag) : []),
    foot(ctx),
  ];
  return { kind: 'kitchen', orderId: o.id, number: o.number, paper: ctx.paper, blocks };
}

// ───────────────────────── «تعديل» (i14) ─────────────────────────

/** What a printed ticket said about each dish, to print only what changed later. */
export interface LineSnap {
  id: string;
  name: string;
  qty: number;
  /** Still to cook when it printed. */
  on: boolean;
}

export function snapLines(o: Pick<BoardOrder, 'groups'>): LineSnap[] {
  return o.groups.flatMap((g) => g.lines.map((l) => ({ id: l.lineId, name: l.name, qty: l.qty, on: l.availability === 'available' })));
}

export interface LineChanges {
  out: PrintItem[];
  add: PrintItem[];
}

/** Dishes taken off or added (or their quantity changed) since `before`. */
export function lineChanges(before: readonly LineSnap[], o: BoardOrder): LineChanges {
  const now = new Map(o.groups.flatMap((g) => g.lines.map((l) => [l.lineId, l] as const)));
  const was = new Map(before.map((s) => [s.id, s] as const));
  const out: PrintItem[] = [];
  const add: PrintItem[] = [];
  for (const s of before) {
    const l = now.get(s.id);
    const qtyNow = l && l.availability === 'available' ? l.qty : 0;
    const qtyWas = s.on ? s.qty : 0;
    if (qtyNow < qtyWas) out.push({ qty: qtyWas - qtyNow, name: s.name, mods: [] });
  }
  for (const [id, l] of now) {
    if (l.availability !== 'available') continue;
    const s = was.get(id);
    const qtyWas = s?.on ? s.qty : 0;
    if (l.qty > qtyWas) add.push({ ...itemOf(l), qty: l.qty - qtyWas });
  }
  return { out, add };
}

/** The short change ticket: only what changed, then «الباقي مثل ما هو». Null when nothing changed. */
export function buildChangeTicket(o: BoardOrder, before: readonly LineSnap[], ctx: PrintCtx): PrintDoc | null {
  const { out, add } = lineChanges(before, o);
  if (!out.length && !add.length) return null;
  const blocks: Block[] = [
    { t: 'band', title: ctx.t('merchant.ticket.change'), sub: ctx.t('merchant.ticket.change_only') },
    head(ctx, o),
    facts(ctx, o),
    ...alerts(ctx, o),
    ...(out.length ? [{ t: 'box' as const, tone: 'out' as const, title: ctx.t('merchant.ticket.take_out'), items: out.map((i) => ({ ...i, sub: ctx.t('merchant.ticket.out_agreed') })) }] : []),
    ...(add.length ? [{ t: 'box' as const, tone: 'add' as const, title: ctx.t('merchant.ticket.add'), items: add }] : []),
    { t: 'who', label: ctx.t('merchant.ticket.rest_same') },
    foot(ctx),
  ];
  return { kind: 'change', orderId: o.id, number: o.number, paper: ctx.paper, blocks };
}

// ───────────────────────── stations (i19) and cups (i20) ─────────────────────────

export type Station = 'kitchen' | 'drinks';
export const STATIONS: readonly Station[] = ['kitchen', 'drinks'];

function stationName(ctx: PrintCtx, s: Station): string {
  return ctx.t(s === 'kitchen' ? 'merchant.ticket.station_kitchen' : 'merchant.ticket.station_drinks');
}

/**
 * One ticket per station when the order has dishes for both (the grill and the tea counter), each
 * «1 من 2» and saying where the rest is, then a packing ticket with tick boxes, the pickup code and
 * the stub. An order for one station only gets the ordinary ticket (null here).
 */
export function buildStationTickets(o: BoardOrder, ctx: PrintCtx, stationOf: (l: BoardLine) => Station, opts: KitchenOptions): PrintDoc[] | null {
  const live = o.groups.flatMap((g) => g.lines).filter((l) => l.availability === 'available');
  const used = STATIONS.filter((s) => live.some((l) => stationOf(l) === s));
  if (used.length < 2) return null;
  const docs: PrintDoc[] = used.map((s, i) => {
    const other = used.find((x) => x !== s)!;
    const blocks: Block[] = [
      { t: 'station', name: stationName(ctx, s), part: ctx.t('merchant.ticket.part', { n: i + 1, of: used.length }) },
      ...bands(ctx, o, opts.reprint),
      head(ctx, o, false),
      ...alerts(ctx, { ...o, groups: o.groups.map((g) => ({ ...g, lines: g.lines.filter((l) => stationOf(l) === s) })) }),
      ...orderNote(ctx, o),
      ...dishes(ctx, o, (l) => stationOf(l) === s && l.availability === 'available'),
      { t: 'foot', start: ctx.t('merchant.ticket.printed_at', { time: clock(ctx, ctx.now) }), end: ctx.t('merchant.ticket.rest_at', { station: stationName(ctx, other) }), wordmark: false },
    ];
    return { kind: 'station', orderId: o.id, number: o.number, paper: ctx.paper, blocks };
  });
  const pack: Block[] = [
    { t: 'station', name: ctx.t('merchant.ticket.station_pack'), part: ctx.t('merchant.ticket.whole_order') },
    { ...(head(ctx, o) as Extract<Block, { t: 'head' }>), ready: null, ...(o.courier.pickupCode ? { code: { label: ctx.t('merchant.ticket.pickup_code'), value: o.courier.pickupCode } } : {}) },
    ...alerts(ctx, o, true),
    ...live.map((l) => ({ t: 'pack' as const, qty: l.qty, name: l.name, station: stationName(ctx, stationOf(l)) })),
    { t: 'count', text: ctx.t('merchant.ticket.in_bag', { count: o.itemCount }) },
    ...(opts.stub ? stubBlocks(ctx, o, opts.itemsPerBag) : []),
    foot(ctx),
  ];
  docs.push({ kind: 'packing', orderId: o.id, number: o.number, paper: ctx.paper, blocks: pack });
  return docs;
}

/** One small label per cup (i20): the number, «1 من 3», the drink and its wishes. Null without drinks. */
export function buildCupLabels(o: BoardOrder, ctx: PrintCtx, isDrink: (l: BoardLine) => boolean): PrintDoc | null {
  const cups = o.groups.flatMap((g) => g.lines).filter((l) => l.availability === 'available' && isDrink(l));
  const total = cups.reduce((a, l) => a + l.qty, 0);
  if (total === 0) return null;
  const blocks: Block[] = [];
  let n = 0;
  for (const l of cups) {
    const mods = itemOf(l).mods.map((m) => m.text).join('، ');
    for (let i = 0; i < l.qty; i += 1) {
      n += 1;
      blocks.push({ t: 'cup', number: o.number, part: ctx.t('merchant.ticket.part', { n, of: total }), name: l.name, mods });
    }
  }
  return { kind: 'cups', orderId: o.id, number: o.number, paper: ctx.paper, blocks };
}
