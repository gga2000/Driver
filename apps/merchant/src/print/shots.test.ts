import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { translate, type TKey } from '@/lib/i18n-core';
import type { PrintDoc, PrintJob } from './doc';
import { jobHtml } from './doc-html';
import { buildChangeTicket, buildCupLabels, buildKitchenTicket, buildStationTickets, snapLines } from './kitchen';
import { paperSpec, type PrinterDots } from './paper';
import { sampleCafeOrder, sampleOrder } from './sample';
import { buildCalibration, buildCustomerSlip } from './slip';
import type { PrintCtx } from './context';

/**
 * Every printed variant at both widths, as HTML pages for `scripts/print-shots.mjs` (which turns them
 * into PNGs at the printer's 8 dots per mm). With PRINT_SHOTS_DIR set the pages are written there;
 * without it this only checks that every variant builds.
 */

const t = (key: TKey, params?: Record<string, string | number>) => translate(key, params, 'ar-IQ');
const NOW = new Date('2026-10-08T17:43:00Z');
const ctx = (dots: PrinterDots): PrintCtx => ({ t, locale: 'ar-IQ', storeName: 'مطعم خالد', now: NOW, paper: paperSpec(dots) });
const order = (patch: Partial<BoardOrder> = {}) => sampleOrder(t, NOW, patch);
const job = (docs: PrintDoc[]): PrintJob => ({ orderId: 'x', number: docs[0]?.number ?? '', docs, beep: false, cut: true });

function variants(): Record<string, PrintDoc[]> {
  const out: Record<string, PrintDoc[]> = {};
  for (const dots of [576, 384] as const) {
    const mm = dots === 576 ? 80 : 58;
    const c = ctx(dots);
    const k = (o: BoardOrder, extra = {}) => buildKitchenTicket(o, c, { stub: true, itemsPerBag: 12, ...extra });
    out[`${mm}-kitchen`] = [k(order())];
    out[`${mm}-slip-cash`] = [buildCustomerSlip(order(), c)];
    out[`${mm}-slip-paid`] = [buildCustomerSlip(order({ paymentMethod: 'wallet', collectCashIqd: 0, bill: { itemsIqd: 21500, deliveryFeeIqd: 2000, serviceFeeIqd: 500, smallOrderFeeIqd: 0, discountIqd: 1500, pointsIqd: 0, changeIqd: 0, totalIqd: 22500 } }), c)];
    out[`${mm}-gift`] = [buildCustomerSlip(order({ paymentMethod: 'wallet', collectCashIqd: 0, gift: { hidePrices: true }, bill: undefined }), c)];
    const courier = { state: 'on_the_way' as const, firstName: 'علي', vehicleClass: 'bike' as const, etaMinutes: 4, arrivedAt: null, pickupCode: '7319' };
    const stubs = k(order({ catering: true, courier }), { itemsPerBag: 5 });
    out[`${mm}-big-order`] = [stubs];
    out[`${mm}-bag-stub`] = [{ ...stubs, blocks: stubs.blocks.filter((b) => b.t === 'tear' || b.t === 'stub') }];
    out[`${mm}-reprint`] = [k(order(), { reprint: { firstAt: NOW, copy: 2 } })];
    const before = snapLines(order());
    const changed = order();
    changed.groups[0]!.lines[2]!.qty = 2;
    changed.groups[1]!.lines[1]!.availability = 'removed';
    changed.groups[1]!.lines.push({ lineId: 'z', name: 'زلابية', qty: 2, modifiers: [], note: 'بدون شيرة', unitPriceIqd: 1000, totalIqd: 2000, availability: 'available' });
    out[`${mm}-change`] = [buildChangeTicket(changed, before, c)!];
    out[`${mm}-scheduled`] = [k(order({ scheduledFor: new Date('2026-10-08T18:30:00Z'), promisedReadyAt: new Date('2026-10-08T18:30:00Z'), courier }))];
    const runOut = order();
    runOut.groups[1]!.lines[0]!.availability = 'removed';
    out[`${mm}-run-out`] = [k(runOut)];
    out[`${mm}-cups`] = [buildCupLabels(sampleCafeOrder(t, NOW), c, () => true)!];
    out[`${mm}-stations`] = buildStationTickets(order({ courier }), c, (l) => (l.name === 'بيبسي' ? 'drinks' : 'kitchen'), { stub: true, itemsPerBag: 12 })!;
  }
  out['calibration'] = [buildCalibration(ctx(576))];
  return out;
}

const FONT_DIR = join(__dirname, '../../node_modules/@expo-google-fonts');
const fontCss = [
  ['IBM Plex Sans Arabic', 400, 'ibm-plex-sans-arabic/400Regular/IBMPlexSansArabic_400Regular.ttf'],
  ['IBM Plex Sans Arabic', 500, 'ibm-plex-sans-arabic/500Medium/IBMPlexSansArabic_500Medium.ttf'],
  ['IBM Plex Sans Arabic', 600, 'ibm-plex-sans-arabic/600SemiBold/IBMPlexSansArabic_600SemiBold.ttf'],
  ['IBM Plex Sans Arabic', 700, 'ibm-plex-sans-arabic/700Bold/IBMPlexSansArabic_700Bold.ttf'],
  ['Alexandria', 700, 'alexandria/700Bold/Alexandria_700Bold.ttf'],
]
  .map(([family, weight, file]) => `@font-face{font-family:"${family}";font-weight:${weight};src:url("file://${join(FONT_DIR, String(file))}")}`)
  .join('');

describe('print shots', () => {
  it('every variant builds at both widths', () => {
    const all = variants();
    expect(Object.keys(all).length).toBeGreaterThan(20);
    for (const [name, docs] of Object.entries(all)) {
      expect(docs.length, name).toBeGreaterThan(0);
      const html = jobHtml(job(docs), { fontCss, mode: 'screen' });
      expect(html, name).toContain('class="paper');
      const dir = process.env.PRINT_SHOTS_DIR;
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.html`), html);
      }
    }
  });
});
