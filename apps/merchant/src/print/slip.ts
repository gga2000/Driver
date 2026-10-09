import { cityParts } from '@driver/i18n';
import type { BoardOrder } from '@driver/contracts';
import type { Block, PrintDoc } from './doc';
import { amount, clock, modsLine, type PrintCtx } from './context';
import { foot } from './kitchen';
import { paperSpec } from './paper';

/**
 * The customer slip that goes in every bag (print redesign, Ali 2026-10-08: k1 every order, k2 every
 * dish + delivery fee + total, k3 the restaurant's name big and «درايفر» small). Every amount is the
 * server's (`order.bill`, the lines' totals): the tablet never adds anything up. A gift gets a gift
 * card instead, with no prices (i23).
 */

function when(ctx: PrintCtx, at: Date): string {
  const day = ctx.t(`time.dow_${cityParts(at).dow}` as Parameters<PrintCtx['t']>[0]);
  return `${day} ${clock(ctx, at)}`;
}

function rows(o: BoardOrder, withPrices: boolean): Block[] {
  return o.groups
    .flatMap((g) => g.lines)
    .filter((l) => l.availability === 'available')
    .map((l) => {
      const sub = modsLine(l);
      return { t: 'row' as const, qty: l.qty, name: l.name, ...(sub ? { sub } : {}), ...(withPrices ? { price: amount(l.totalIqd) } : {}) };
    });
}

function stamp(ctx: PrintCtx, o: BoardOrder): Block {
  return o.paymentMethod === 'cash' && o.collectCashIqd > 0
    ? { t: 'stamp', kind: 'cash', top: ctx.t('merchant.slip.pay_courier'), amount: amount(o.collectCashIqd), unit: ctx.t('merchant.ticket.dinar') }
    : { t: 'stamp', kind: 'paid', text: ctx.t('merchant.slip.paid_app') };
}

/** The bill's lines; only what is there (no «الخصم 0»). Null when the API sent no bill. */
function sums(ctx: PrintCtx, o: BoardOrder): Block | null {
  const b = o.bill;
  if (!b) return null;
  const r: { label: string; value: string }[] = [{ label: ctx.t('merchant.slip.food'), value: amount(b.itemsIqd) }];
  r.push({ label: ctx.t('merchant.slip.delivery'), value: b.deliveryFeeIqd > 0 ? amount(b.deliveryFeeIqd) : ctx.t('merchant.slip.free') });
  if (b.serviceFeeIqd > 0) r.push({ label: ctx.t('merchant.slip.service'), value: amount(b.serviceFeeIqd) });
  if (b.smallOrderFeeIqd > 0) r.push({ label: ctx.t('merchant.slip.small_order'), value: amount(b.smallOrderFeeIqd) });
  if (b.discountIqd > 0) r.push({ label: ctx.t('merchant.slip.discount'), value: amount(-b.discountIqd) });
  if (b.pointsIqd > 0) r.push({ label: ctx.t('merchant.slip.points'), value: amount(-b.pointsIqd) });
  if (b.changeIqd > 0) r.push({ label: ctx.t('merchant.slip.change'), value: amount(b.changeIqd) });
  return { t: 'sum', rows: r };
}

export function buildCustomerSlip(o: BoardOrder, ctx: PrintCtx): PrintDoc {
  if (o.gift) return buildGiftCard(o, ctx);
  const sum = sums(ctx, o);
  const blocks: Block[] = [
    { t: 'store', text: ctx.storeName },
    { t: 'hello', text: ctx.t('merchant.slip.hello') },
    { t: 'meta', label: ctx.t('merchant.ticket.order'), number: o.number, when: when(ctx, o.placedAt) },
    { t: 'double' },
    ...rows(o, true),
    ...(sum ? [sum] : []),
    { t: 'total', label: ctx.t('merchant.slip.total'), amount: amount(o.bill?.totalIqd ?? o.totalIqd), unit: ctx.t('merchant.ticket.dinar') },
    stamp(ctx, o),
    { t: 'help', text: ctx.t('merchant.slip.help') },
    foot(ctx),
  ];
  return { kind: 'slip', orderId: o.id, number: o.number, paper: ctx.paper, blocks };
}

/**
 * «هدية إلك» (i23): the dishes without prices, who it is from, and «مدفوع» — or, for a gift paid in
 * cash, the amount the person at the door hands over. The sender's own card message never reaches the
 * server (it travels in his WhatsApp heads-up), so the card says «بطلب من شخص يحبك».
 */
export function buildGiftCard(o: BoardOrder, ctx: PrintCtx): PrintDoc {
  const cash = o.paymentMethod === 'cash' && o.collectCashIqd > 0;
  const blocks: Block[] = [
    { t: 'gift', title: ctx.t('merchant.slip.gift_title'), from: ctx.t('merchant.slip.gift_from', { store: ctx.storeName }) },
    { t: 'double' },
    ...rows(o, false),
    { t: 'double' },
    cash ? stamp(ctx, o) : { t: 'stamp', kind: 'paid', text: ctx.t('merchant.slip.gift_paid') },
    foot(ctx, ctx.t('merchant.slip.order_no', { number: o.number })),
  ];
  return { kind: 'gift', orderId: o.id, number: o.number, paper: ctx.paper, blocks };
}

/**
 * «اطبع مسطرة» (i27): three black bars, 48, 64 and 72 mm long, numbered at their far end. A head
 * prints only its own width from the left, so the last number that comes out whole is the printer's
 * width: 1 = 58 mm (384 dots), 2 = 80 mm narrow (512), 3 = 80 mm (576). Always drawn at 576 dots.
 */
export function buildCalibration(ctx: PrintCtx): PrintDoc {
  const paper = paperSpec(576);
  const blocks: Block[] = [
    { t: 'store', text: ctx.t('merchant.calibrate.title') },
    { t: 'text', text: ctx.t('merchant.calibrate.how'), center: true },
    {
      t: 'ruler',
      bars: [
        { dots: 384, mm: 48, label: ctx.t('merchant.calibrate.bar', { n: 1 }) },
        { dots: 512, mm: 64, label: ctx.t('merchant.calibrate.bar', { n: 2 }) },
        { dots: 576, mm: 72, label: ctx.t('merchant.calibrate.bar', { n: 3 }) },
      ],
    },
    { t: 'text', text: ctx.t('merchant.calibrate.then'), strong: true, center: true },
    { t: 'text', text: ctx.t('merchant.calibrate.sample') },
    foot({ ...ctx, paper }),
  ];
  return { kind: 'calibration', orderId: 'calibration', number: '', paper, blocks };
}
