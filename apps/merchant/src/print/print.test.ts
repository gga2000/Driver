import { describe, expect, it } from 'vitest';
import type { BoardOrder } from '@driver/contracts';
import { createMemoryStorage } from '@/lib/storage';
import { translate, type TKey } from '@/lib/i18n-core';
import type { Block, PrintDoc } from './doc';
import { jobHtml } from './doc-html';
import { COMMANDS, jobBytes, rasterBytes, STRIP_ROWS, toBitmap } from './escpos';
import { createPrintJournal, JOURNAL_KEEP } from './journal';
import { buildChangeTicket, buildCupLabels, buildKitchenTicket, buildStationTickets, lineChanges, snapLines } from './kitchen';
import { paperSpec } from './paper';
import { autoPrintWhen, CATCH_UP_MS, catchUpDue, planOrderJob, printsOnScreen } from './plan';
import { toPlainText } from './plain';
import { sampleCafeOrder, sampleOrder } from './sample';
import { DEFAULT_PRINT_SETTINGS, parsePrintSettings } from './settings';
import { buildCalibration, buildCustomerSlip } from './slip';
import type { PrintCtx } from './context';

const t = (key: TKey, params?: Record<string, string | number>) => translate(key, params, 'ar-IQ');
// 8:43 م Baghdad (UTC+3) on Thursday 8 Oct 2026.
const NOW = new Date('2026-10-08T17:43:00Z');
const ctx = (dots: 384 | 512 | 576 = 576): PrintCtx => ({ t, locale: 'ar-IQ', storeName: 'مطعم خالد', now: NOW, paper: paperSpec(dots) });
const order = (patch: Partial<BoardOrder> = {}) => sampleOrder(t, NOW, patch);
const kitchen = (o: BoardOrder = order(), dots: 384 | 576 = 576, extra: Partial<Parameters<typeof buildKitchenTicket>[2]> = {}) => buildKitchenTicket(o, ctx(dots), { stub: true, itemsPerBag: 12, ...extra });
const of = <K extends Block['t']>(d: PrintDoc, k: K) => d.blocks.filter((b): b is Extract<Block, { t: K }> => b.t === k);
const MONEY = /\d{1,3},\d{3}/;

describe('the kitchen ticket «الريل»', () => {
  it('opens with the number and the ready time big, then the facts', () => {
    const d = kitchen();
    expect(d.blocks[0]).toEqual({ t: 'head', label: 'طلب', number: '4821', ready: { label: 'جاهز', time: '8:57', period: 'مساءً' } });
    expect(d.blocks[1]).toEqual({ t: 'facts', parts: ['توصيل', 'انطلب 8:42', '9 أصناف'] });
  });

  it('puts the allergy on top as a black band and again on its dish (i03), not as a wish (i04)', () => {
    const d = kitchen();
    expect(d.blocks[2]).toEqual({ t: 'alert', title: 'حساسية فستق', sub: 'لـ أبو حسين · كنافة' });
    const knafeh = of(d, 'item').find((i) => i.name === 'كنافة')!;
    expect(knafeh.allergy).toBe('حساسية فستق');
    expect(knafeh.mods).toEqual([]);
    const tikka = of(d, 'item').find((i) => i.name === 'لفة تكة')!;
    expect(tikka.mods).toEqual([
      { text: 'صمون', mark: 'plus' },
      { text: 'حار', mark: 'plus' },
      { text: 'بدون بصل', mark: 'no' },
    ]);
  });

  it('an order note that is an allergy becomes the band; any other note sits above the dishes (i07)', () => {
    const d = kitchen();
    const note = d.blocks.findIndex((b) => b.t === 'note');
    expect(d.blocks[note]).toEqual({ t: 'note', label: 'ملاحظة الطلب', text: 'ملاعق زايدة، والصلصة على جنب' });
    expect(note).toBeLessThan(d.blocks.findIndex((b) => b.t === 'item'));
    const allergic = kitchen(order({ note: 'وحدة من البنات عندها حساسية من الحليب' }));
    expect(of(allergic, 'note')).toEqual([]);
    expect(of(allergic, 'alert')[0]).toEqual({ t: 'alert', title: 'وحدة من البنات عندها حساسية من الحليب', sub: 'ملاحظة الطلب' });
  });

  it('groups by person with thin labelled rules and counts (i26), and prints no money but the stub cash (i08)', () => {
    const d = kitchen();
    expect(of(d, 'who')).toEqual([
      { t: 'who', label: 'صاحب الطلب', count: 6 },
      { t: 'who', label: 'لـ أبو حسين', count: 3 },
    ]);
    const { stub, ...rest } = Object.fromEntries(d.blocks.map((b, i) => [b.t === 'stub' ? 'stub' : String(i), b]));
    expect(JSON.stringify(rest)).not.toMatch(MONEY);
    expect(stub).toMatchObject({ money: { kind: 'cash', label: 'كاش', amount: '23,500', unit: 'دينار' } });
  });

  it('counts the bag (i25) and ends with the stub (i09) and «انطبع» + «درايفر» (i24, i30)', () => {
    const d = kitchen();
    expect(of(d, 'count')).toEqual([{ t: 'count', text: '9 أصناف بالكيس' }]);
    expect(of(d, 'tear')).toEqual([{ t: 'tear', text: 'قص هنا وحطه على الكيس' }]);
    expect(of(d, 'stub')[0]).toEqual({
      t: 'stub',
      numberLabel: 'طلب',
      number: '4821',
      code: { label: 'رمز الاستلام', value: null, blank: 'بموبايل الدليفري' },
      money: { kind: 'cash', label: 'كاش', amount: '23,500', unit: 'دينار' },
      items: '9 أصناف',
      bag: 'كيس 1 من 1',
    });
    expect(d.blocks.at(-1)).toEqual({ t: 'foot', start: 'انطبع 8:43 م', end: 'درايفر', wordmark: true });
  });

  it('prints the pickup code and the courier when he is assigned (i11, i12); paid orders say so', () => {
    const d = kitchen(order({ paymentMethod: 'wallet', collectCashIqd: 0, courier: { state: 'on_the_way', firstName: 'علي', vehicleClass: 'bike', etaMinutes: 4, arrivedAt: null, pickupCode: '7319' } }));
    expect(of(d, 'stub')[0]).toMatchObject({ code: { value: '7319' }, money: { kind: 'paid', text: 'مدفوع بالتطبيق' }, courier: 'الدليفري: علي' });
  });

  it('big orders: «طلب كبير» band (i18) and one stub per bag, «كيس 1 من 2» (i10)', () => {
    const d = kitchen(order({ catering: true }), 576, { itemsPerBag: 5 });
    expect(of(d, 'band')).toEqual([{ t: 'band', title: 'طلب كبير', sub: '9 أصناف' }]);
    expect(of(d, 'stub').map((s) => s.bag)).toEqual(['كيس 1 من 2', 'كيس 2 من 2']);
  });

  it('a reprint carries «نسخة ثانية» with the first print time, a third «نسخة رقم 3» (i13)', () => {
    expect(of(kitchen(order(), 576, { reprint: { firstAt: new Date('2026-10-08T17:40:00Z'), copy: 2 } }), 'band')[0]).toEqual({ t: 'band', title: 'نسخة ثانية', sub: 'انطبعت أول مرة 8:40 م' });
    expect(of(kitchen(order(), 576, { reprint: { firstAt: NOW, copy: 3 } }), 'band')[0]!.title).toBe('نسخة رقم 3');
  });

  it('a scheduled order says «مجدول» and for when (i17)', () => {
    const d = kitchen(order({ scheduledFor: new Date('2026-10-08T18:30:00Z') }));
    expect(of(d, 'band')[0]).toEqual({ t: 'band', title: 'مجدول', sub: 'للساعة 9:30 م' });
  });

  it('run-out dishes leave the cooking list for a «شيل من الطلب» box (i15)', () => {
    const o = order();
    o.groups[1]!.lines[0]!.availability = 'removed';
    const d = kitchen(o);
    expect(of(d, 'item').some((i) => i.name === 'شوربة عدس')).toBe(false);
    expect(of(d, 'box')).toEqual([{ t: 'box', tone: 'out', title: 'شيل من الطلب', items: [{ qty: 1, name: 'شوربة عدس', mods: [], sub: 'خلص · الزبون وافق' }] }]);
  });

  it('58 mm is its own size, not a shrunk 80 (k5)', () => {
    const narrow = paperSpec(384);
    expect(narrow).toMatchObject({ paperMm: 58, contentMm: 48, num: 12.5, item: 5.4 });
    expect(paperSpec(512)).toMatchObject({ paperMm: 80, contentMm: 64 });
    const html = jobHtml({ orderId: 'x', number: '4821', docs: [kitchen(order(), 384)], beep: false, cut: true });
    expect(html).toContain('--w:58mm');
    expect(html).toContain('--num:12.5mm');
    expect(html).toContain('size:58mm auto');
  });

  it('plain text keeps every line inside the paper on both widths', () => {
    for (const [dots, cols] of [
      [576, 48],
      [384, 32],
    ] as const) {
      for (const row of toPlainText(kitchen(order(), dots)).split('\n')) expect([...row].length, row).toBeLessThanOrEqual(cols);
    }
    expect(toPlainText(kitchen())).toContain('✕ **بدون بصل**');
  });
});

describe('the «تعديل» ticket (i14)', () => {
  it('prints only what changed and «الباقي مثل ما هو»', () => {
    const before = snapLines(order());
    const o = order();
    o.groups[0]!.lines[2]!.qty = 1; // Pepsi 3 → 1
    o.groups[1]!.lines[0]!.availability = 'removed';
    o.groups[1]!.lines.push({ lineId: 'n1', name: 'زلابية', qty: 2, modifiers: [], note: null, unitPriceIqd: 1000, totalIqd: 2000, availability: 'available' });
    expect(lineChanges(before, o)).toEqual({
      out: [
        { qty: 2, name: 'بيبسي', mods: [] },
        { qty: 1, name: 'شوربة عدس', mods: [] },
      ],
      add: [{ qty: 2, name: 'زلابية', mods: [] }],
    });
    const d = buildChangeTicket(o, before, ctx())!;
    expect(d.blocks[0]).toEqual({ t: 'band', title: 'تعديل على الطلب', sub: 'هذا اللي تغيّر بس' });
    expect(of(d, 'box').map((b) => [b.tone, b.title])).toEqual([
      ['out', 'شيل من الطلب'],
      ['add', 'زيد على الطلب'],
    ]);
    expect(of(d, 'who')).toEqual([{ t: 'who', label: 'الباقي مثل ما هو' }]);
    expect(buildChangeTicket(order(), snapLines(order()), ctx())).toBeNull();
  });
});

describe('the customer slip (k1–k3)', () => {
  it('the restaurant big, «بالعافية عليكم», every dish with the server price, the bill and the total (i21, i22)', () => {
    const d = buildCustomerSlip(order({ bill: { itemsIqd: 21500, deliveryFeeIqd: 2000, serviceFeeIqd: 500, smallOrderFeeIqd: 0, discountIqd: 1000, pointsIqd: 0, changeIqd: 0, totalIqd: 23000 }, collectCashIqd: 23000 }), ctx());
    expect(d.blocks.slice(0, 3)).toEqual([
      { t: 'store', text: 'مطعم خالد' },
      { t: 'hello', text: 'بالعافية عليكم' },
      { t: 'meta', label: 'طلب', number: '4821', when: 'الخميس 8:42 م' },
    ]);
    expect(of(d, 'row')[0]).toEqual({ t: 'row', qty: 2, name: 'لفة تكة', sub: 'صمون، حار، بدون بصل', price: '5,000' });
    expect(of(d, 'sum')[0]!.rows.map((r) => r.label)).toEqual(['الأكل', 'التوصيل', 'الخدمة', 'الخصم']);
    expect(of(d, 'sum')[0]!.rows[3]!.value).toContain('1,000');
    expect(of(d, 'total')).toEqual([{ t: 'total', label: 'المجموع', amount: '23,000', unit: 'دينار' }]);
    // The round «كاش» stamp (i31) with what the courier collects; the help line (i32).
    expect(of(d, 'stamp')).toEqual([{ t: 'stamp', kind: 'cash', top: 'ادفع للدليفري', amount: '23,000', unit: 'دينار' }]);
    expect(of(d, 'help')[0]!.text).toContain('افتح الطلب');
  });

  it('never adds anything up: the total is the server\'s even when the lines would say otherwise', () => {
    const d = buildCustomerSlip(order({ bill: { itemsIqd: 1, deliveryFeeIqd: 0, serviceFeeIqd: 0, smallOrderFeeIqd: 0, discountIqd: 0, pointsIqd: 0, changeIqd: 250, totalIqd: 99_750 } }), ctx());
    expect(of(d, 'total')[0]!.amount).toBe('99,750');
    expect(of(d, 'sum')[0]!.rows).toEqual([
      { label: 'الأكل', value: '1' },
      { label: 'التوصيل', value: 'مجاني' },
      { label: 'الخردة لمحفظتك', value: '250' },
    ]);
  });

  it('paid in the app: a «مدفوع» box instead of the stamp; an older API without a bill prints no sums', () => {
    const d = buildCustomerSlip(order({ paymentMethod: 'wallet', collectCashIqd: 0, bill: undefined }), ctx(384));
    expect(of(d, 'stamp')).toEqual([{ t: 'stamp', kind: 'paid', text: 'مدفوع بالتطبيق' }]);
    expect(of(d, 'sum')).toEqual([]);
    expect(of(d, 'total')[0]!.amount).toBe('23,500');
  });

  it('a gift gets a gift card with no prices at all (i23)', () => {
    const d = buildCustomerSlip(order({ paymentMethod: 'wallet', collectCashIqd: 0, gift: { hidePrices: true }, bill: undefined }), ctx(384));
    expect(d.kind).toBe('gift');
    expect(d.blocks[0]).toEqual({ t: 'gift', title: 'هدية إلك', from: 'من مطعم خالد، بطلب من شخص يحبك' });
    expect(JSON.stringify(d.blocks)).not.toMatch(MONEY);
    expect(of(d, 'stamp')).toEqual([{ t: 'stamp', kind: 'paid', text: 'مدفوع، ولا تدفع شي' }]);
  });
});

describe('stations, cups and the ruler', () => {
  const drinks = (l: { name: string }) => (l.name === 'بيبسي' ? 'drinks' : 'kitchen');

  it('one ticket per station «1 من 2» saying where the rest is, then a packing ticket (i19)', () => {
    const docs = buildStationTickets(order(), ctx(), drinks, { stub: true, itemsPerBag: 12 })!;
    expect(docs.map((d) => d.kind)).toEqual(['station', 'station', 'packing']);
    expect(docs[0]!.blocks[0]).toEqual({ t: 'station', name: 'المطبخ', part: '1 من 2' });
    expect(of(docs[1]!, 'item').map((i) => i.name)).toEqual(['بيبسي']);
    expect(of(docs[1]!, 'foot')[0]!.end).toBe('باقي الطلب عند المطبخ');
    expect(of(docs[2]!, 'pack')).toHaveLength(5);
    expect(of(docs[2]!, 'stub')).toHaveLength(1);
    expect(buildStationTickets(order(), ctx(), () => 'kitchen', { stub: true, itemsPerBag: 12 })).toBeNull();
  });

  it('a cup label per cup, «1 من 3» (i20)', () => {
    const d = buildCupLabels(sampleCafeOrder(t, NOW), ctx(384), () => true)!;
    expect(of(d, 'cup')).toEqual([
      { t: 'cup', number: '1170', part: '1 من 3', name: 'نسكافيه', mods: 'حليب، سكر خفيف' },
      { t: 'cup', number: '1170', part: '2 من 3', name: 'چاي حامض', mods: '' },
      { t: 'cup', number: '1170', part: '3 من 3', name: 'چاي حامض', mods: '' },
    ]);
  });

  it('«اطبع مسطرة» draws 48, 64 and 72 mm bars numbered 1–3 on a 576-dot page (i27)', () => {
    const d = buildCalibration(ctx(384));
    expect(d.paper.dots).toBe(576);
    expect(of(d, 'ruler')[0]!.bars.map((b) => [b.dots, b.mm, b.label])).toEqual([
      [384, 48, '1'],
      [512, 64, '2'],
      [576, 72, '3'],
    ]);
  });
});

describe('what one order prints, and when', () => {
  const base = { ctx: { t, locale: 'ar-IQ' as const, storeName: 'مطعم خالد', now: NOW } };

  it('kitchen ticket, then the customer slip, with beep and cut (k1, i28, i29)', () => {
    const job = planOrderJob({ ...base, order: order(), settings: DEFAULT_PRINT_SETTINGS });
    expect(job.docs.map((d) => d.kind)).toEqual(['kitchen', 'slip']);
    expect(job).toMatchObject({ beep: true, cut: true });
    expect(job.docs[0]!.paper.dots).toBe(576);
  });

  it('follows the settings: 58 mm, no slip, two kitchen copies (only the first with the stub)', () => {
    const job = planOrderJob({ ...base, order: order(), settings: { ...DEFAULT_PRINT_SETTINGS, dots: 384, slip: false, copies: 2 } });
    expect(job.docs.map((d) => [d.kind, d.paper.paperMm, d.blocks.some((b) => b.t === 'stub')])).toEqual([
      ['kitchen', 58, true],
      ['kitchen', 58, false],
    ]);
  });

  it('a reprint is marked, never beeps and prints no extra copies or cups', () => {
    const job = planOrderJob({ ...base, order: order(), settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2, cups: true }, previous: { count: 1, firstAt: NOW.getTime() } });
    expect(job.docs.map((d) => d.kind)).toEqual(['kitchen', 'slip']);
    expect(job.beep).toBe(false);
    expect(of(job.docs[0]!, 'band')[0]!.title).toBe('نسخة ثانية');
  });

  it('a café prints cup labels by default; stations split by menu section', () => {
    const cafe = planOrderJob({ ...base, order: sampleCafeOrder(t, NOW), settings: DEFAULT_PRINT_SETTINGS, prepKind: 'drinks' });
    expect(cafe.docs.map((d) => d.kind)).toEqual(['kitchen', 'cups', 'slip']);
    const split = planOrderJob({ ...base, order: order(), settings: { ...DEFAULT_PRINT_SETTINGS, stations: true, drinkSections: ['مشروبات'] }, sectionOf: (n) => (n === 'بيبسي' ? 'مشروبات' : 'مشاوي') });
    expect(split.docs.map((d) => d.kind)).toEqual(['station', 'station', 'packing', 'slip']);
  });

  it('auto-print waits for a partial answer (i16) and for a scheduled start (i17)', () => {
    const now = NOW.getTime();
    expect(autoPrintWhen(order(), now)).toEqual({ kind: 'now' });
    expect(autoPrintWhen(order({ partial: { unavailableLineIds: ['s4'], deadline: NOW } }), now)).toEqual({ kind: 'wait' });
    expect(autoPrintWhen(order({ column: 'new' }), now)).toEqual({ kind: 'wait' });
    const at = new Date(now + 2 * 3_600_000);
    expect(autoPrintWhen(order({ scheduledFor: at, promisedReadyAt: at, prepMinutes: 25 }), now)).toEqual({ kind: 'at', at: at.getTime() - 25 * 60_000 });
    expect(autoPrintWhen(order({ scheduledFor: new Date(now + 10 * 60_000), promisedReadyAt: null, prepMinutes: 25 }), now)).toEqual({ kind: 'now' });
  });
});

describe('the counter printer and devices without one (MER-11)', () => {
  it('shows the ticket on screen when there is no printer to send to', () => {
    expect(printsOnScreen({ kind: 'preview', connection: 'connected', name: null })).toBe(true);
    expect(printsOnScreen({ kind: 'bluetooth', connection: 'not_set_up', name: null })).toBe(true);
    expect(printsOnScreen({ kind: 'bluetooth', connection: 'disconnected', name: 'XP-80' })).toBe(false);
    expect(printsOnScreen({ kind: 'bluetooth', connection: 'connected', name: 'XP-80' })).toBe(false);
  });

  it('prints orders another device accepted, once, when recent and ready to cook', () => {
    const now = NOW.getTime();
    const accepted = order({ column: 'preparing', acceptedAt: new Date(now - 60_000) });
    const ready = { printerReady: true, printedBefore: false };
    expect(catchUpDue(accepted, now, ready)).toBe(true);
    expect(catchUpDue(accepted, now, { ...ready, printedBefore: true })).toBe(false);
    expect(catchUpDue(accepted, now, { ...ready, printerReady: false })).toBe(false);
    expect(catchUpDue(order({ column: 'preparing', acceptedAt: new Date(now - CATCH_UP_MS - 1) }), now, ready)).toBe(false);
    expect(catchUpDue(order({ column: 'new', acceptedAt: null }), now, ready)).toBe(false);
    expect(catchUpDue(order({ column: 'ready', acceptedAt: new Date(now - 60_000) }), now, ready)).toBe(false);
    expect(catchUpDue(order({ column: 'preparing', acceptedAt: new Date(now - 60_000), partial: { unavailableLineIds: ['s4'], deadline: NOW } }), now, ready)).toBe(false);
  });
});

describe('device journal and settings', () => {
  it('counts prints per order, keeps the first time and a short history, and survives a restart', async () => {
    const store = createMemoryStorage();
    const j = createPrintJournal(store);
    await j.load();
    expect(j.printed('a', snapLines(order()), 1000)).toMatchObject({ count: 1, firstAt: 1000 });
    expect(j.printed('a', snapLines(order()), 2000)).toMatchObject({ count: 2, firstAt: 1000 });
    for (let i = 0; i < JOURNAL_KEEP + 3; i += 1) j.printed(`o${i}`, [], i);
    expect(j.get('a')).toBeNull();
    const again = createPrintJournal(store);
    await again.load();
    expect(again.get(`o${JOURNAL_KEEP + 2}`)).toMatchObject({ count: 1 });
  });

  it('settings default to Ali\'s calls and ignore junk', () => {
    expect(parsePrintSettings(null)).toEqual(DEFAULT_PRINT_SETTINGS);
    expect(DEFAULT_PRINT_SETTINGS).toMatchObject({ slip: true, stub: true, dots: 576 });
    expect(parsePrintSettings('{"dots":384,"copies":5,"itemsPerBag":-1,"drinkSections":["عصائر",3]}')).toMatchObject({ dots: 384, copies: 1, itemsPerBag: 12, drinkSections: ['عصائر'] });
    expect(parsePrintSettings('not json')).toEqual(DEFAULT_PRINT_SETTINGS);
  });
});

describe('ESC/POS bytes', () => {
  it('turns pixels into black-and-white dots, no grey', () => {
    // 8×1: black, dark grey, light grey, white, transparent black, 3× black.
    const px = [0, 0, 0, 255, 90, 90, 90, 255, 200, 200, 200, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255];
    expect([...toBitmap(Uint8Array.from(px), 8, 1).data]).toEqual([0b11000111]);
  });

  it('sends GS v 0 strips, a beep first and a cut after each document', () => {
    const img = { width: 16, height: STRIP_ROWS + 1, data: new Uint8Array(2 * (STRIP_ROWS + 1)) };
    const raster = rasterBytes(img);
    expect(raster.slice(0, 8)).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 0, 1]);
    expect(raster.length).toBe(8 + 2 * STRIP_ROWS + 8 + 2);
    const all = [...jobBytes([img, img], { beep: true, cut: true })];
    expect(all.slice(0, 6)).toEqual([...COMMANDS.init, ...COMMANDS.beep]);
    expect(all.slice(-4)).toEqual([...COMMANDS.cut]);
    const quiet = [...jobBytes([img], { beep: false, cut: false })];
    expect(quiet.slice(-3)).toEqual([...COMMANDS.feed]);
  });
});

describe('the print page', () => {
  it('is RTL, escaped, carries the fonts it is given and one page per paper when cutting', () => {
    const html = jobHtml(planOrderJob({ ctx: { t, locale: 'ar-IQ', storeName: '<b>x</b>', now: NOW }, order: order(), settings: DEFAULT_PRINT_SETTINGS }), { fontCss: '@font-face{font-family:"Alexandria"}' });
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('@font-face{font-family:"Alexandria"}');
    expect(html).toContain('break-after:page');
    expect(html).not.toContain('#4821');
  });
});
