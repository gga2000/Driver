import { describe, expect, it } from 'vitest';
import type { DriverDocumentView, EarningsJobLine, MainPhotoView } from '@driver/contracts';
import { createT } from '@driver/i18n';
import {
  memberSpan,
  papersReminder,
  papersPill,
  checkInPill,
  scoreParts,
  weakestPart,
  bestWindowLabel,
  dayPart,
  jobTipIqd,
  breakdownRows,
  capTone,
  cashTruth,
  chartBuckets,
  clockTime,
  componentLabel,
  docAction,
  docsSummary,
  documentRows,
  expiryFromMonth,
  expiryText,
  gateKind,
  local,
  mainPhotoNote,
  mainPhotoStatus,
  metricFormat,
  metricPos,
  nextTierCap,
  nextTierProgress,
  observation,
  percentChange,
  periodContainsNow,
  rangeLabel,
  shortRef,
  startOfLocalDay,
  tierTrackShare,
} from './logic';

const t = createT('ar-IQ');
/** Saturday 3 Oct 2026, 14:20 in Baghdad. */
const NOW = new Date('2026-10-03T11:20:00Z');
const DAY = 86_400_000;

function job(at: string, netIqd: number, extra: Partial<EarningsJobLine> = {}): EarningsJobLine {
  return { key: `k-${at}`, tripId: 't', orderId: null, at: new Date(at), components: [], netIqd, cashCollectedIqd: 0, ...extra };
}

function doc(kind: DriverDocumentView['kind'], status: DriverDocumentView['status'], extra: Partial<DriverDocumentView> = {}): DriverDocumentView {
  return { id: kind, kind, kind_ar: kind, status, status_ar: status, expiresAt: null, daysToExpiry: null, submittedAt: NOW, reviewedAt: null, rejectReason: null, ...extra };
}

describe('Baghdad calendar', () => {
  it('reads local parts at UTC+3 and cuts days at local midnight', () => {
    expect(local(NOW)).toMatchObject({ year: 2026, month: 10, day: 3, hour: 14, minute: 20, weekday: 6 });
    expect(startOfLocalDay(new Date('2026-10-02T22:30:00Z')).toISOString()).toBe('2026-10-02T21:00:00.000Z');
    expect(clockTime(NOW)).toBe('2:20');
    expect(clockTime(new Date('2026-10-02T21:05:00Z'))).toBe('12:05');
  });

  it('names periods the way he says them', () => {
    const today = { from: startOfLocalDay(NOW), to: new Date(startOfLocalDay(NOW).getTime() + DAY) };
    expect(rangeLabel('day', today, NOW, t)).toBe('اليوم');
    expect(rangeLabel('day', { from: new Date(today.from.getTime() - DAY), to: today.from }, NOW, t)).toBe('أمس');
    expect(rangeLabel('day', { from: new Date(today.from.getTime() - 2 * DAY), to: today.from }, NOW, t)).toBe('الخميس 1 تشرين الأول');
    const week = new Date(today.from.getTime() - 6 * DAY); // Sunday 27 Sep
    expect(rangeLabel('week', { from: week, to: new Date(week.getTime() + 7 * DAY) }, NOW, t)).toBe('هالأسبوع');
    expect(rangeLabel('week', { from: new Date(week.getTime() - 7 * DAY), to: week }, NOW, t)).toBe('الأسبوع الفات');
    expect(rangeLabel('week', { from: new Date(week.getTime() - 14 * DAY), to: new Date(week.getTime() - 7 * DAY) }, NOW, t)).toBe('\u206713 أيلول – 19 أيلول\u2069');
    expect(rangeLabel('month', { from: new Date('2026-09-30T21:00:00Z'), to: new Date('2026-10-31T21:00:00Z') }, NOW, t)).toBe('هالشهر');
    expect(rangeLabel('month', { from: new Date('2026-07-31T21:00:00Z'), to: new Date('2026-08-31T21:00:00Z') }, NOW, t)).toBe('آب');
  });

  it('knows when the next period is the live one', () => {
    expect(periodContainsNow('day', startOfLocalDay(NOW), NOW)).toBe(true);
    expect(periodContainsNow('day', new Date(startOfLocalDay(NOW).getTime() - DAY), NOW)).toBe(false);
    expect(periodContainsNow('month', new Date('2026-09-30T21:00:00Z'), NOW)).toBe(true);
  });
});

describe('earnings', () => {
  it('buckets a day by local hour from 6 (earlier when he worked earlier)', () => {
    const from = startOfLocalDay(NOW);
    const b = chartBuckets('day', { from, to: new Date(from.getTime() + DAY) }, [job('2026-10-03T05:10:00Z', 2_000), job('2026-10-03T05:40:00Z', 1_500), job('2026-10-03T10:00:00Z', 3_000)], t);
    expect(b[0]!.tick).toBe('6');
    expect(b.length).toBe(18);
    expect(b.find((x) => x.key === 'h8')).toMatchObject({ amountIqd: 3_500, jobs: 2 });
    expect(b.find((x) => x.key === 'h13')).toMatchObject({ amountIqd: 3_000, jobs: 1, tick: '1' });
    const early = chartBuckets('day', { from, to: new Date(from.getTime() + DAY) }, [job('2026-10-02T23:30:00Z', 500)], t);
    expect(early[0]!.key).toBe('h2');
  });

  it('buckets a week by local day; adjustments add money but not jobs', () => {
    const from = new Date('2026-09-26T21:00:00Z');
    const b = chartBuckets('week', { from, to: new Date(from.getTime() + 7 * DAY) }, [job('2026-09-27T09:00:00Z', 4_000), job('2026-09-27T20:59:00Z', 1_000, { tripId: null })], t);
    expect(b.map((x) => x.tick)).toEqual(['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت']);
    expect(b[0]).toMatchObject({ amountIqd: 5_000, jobs: 1, label: 'الأحد' });
  });

  it('compares with the previous period only when there is one', () => {
    expect(percentChange(11_000, 10_000)).toBe(10);
    expect(percentChange(9_000, 12_000)).toBe(-25);
    expect(percentChange(9_000, 0)).toBeNull();
    expect(percentChange(9_000, null)).toBeNull();
  });

  it('names components by the ledger label, refined by the memo', () => {
    expect(componentLabel({ label_ar: 'مكافأة من الشركة', memo: 'guarantee:2026-10-02:evening' }, t)).toBe('تكملة ضمان الشفت');
    expect(componentLabel({ label_ar: 'أجور التوصيل', memo: 'night' }, t)).toBe('إضافة الليل');
    expect(componentLabel({ label_ar: 'إكرامية', memo: null }, t)).toBe('إكرامية');
  });

  it('breakdown drops empty rows, shows the take as a minus, ends with the net', () => {
    const rows = breakdownRows({ grossIqd: 20_000, takeIqd: 1_500, tipsIqd: 2_000, bonusesIqd: 0, guaranteeTopUpsIqd: 3_000, penaltiesIqd: 0, netIqd: 23_500, jobs: 9 });
    expect(rows.map((r) => [r.key, r.amountIqd])).toEqual([
      ['partner.earn_gross', 20_000],
      ['partner.earn_tips', 2_000],
      ['partner.earn_guarantee', 3_000],
      ['partner.earn_take', -1_500],
      ['partner.earn_net', 23_500],
    ]);
  });

  it('colours the cap bar honestly (P-05): green, amber from 70 %, red from 90 % and over; names the next tier', () => {
    expect(capTone({ fill: 0.4, overCap: false })).toBe('success');
    expect(capTone({ fill: 0.69, overCap: false })).toBe('success');
    expect(capTone({ fill: 0.7, overCap: false })).toBe('warning');
    expect(capTone({ fill: 0.89, overCap: false })).toBe('warning');
    expect(capTone({ fill: 0.9, overCap: false })).toBe('danger');
    expect(capTone({ fill: 1, overCap: true })).toBe('danger');
    expect(nextTierCap({ tier: 'bronze', capIqd: 75_000, byTier: { bronze: 75_000, silver: 150_000, gold: 300_000 } })).toEqual({ tier: 'silver', capIqd: 150_000 });
    expect(nextTierCap({ tier: 'gold', capIqd: 300_000, byTier: { bronze: 75_000, silver: 150_000, gold: 300_000 } })).toBeNull();
    expect(nextTierCap({ tier: 'bronze', capIqd: 300_000, byTier: { bronze: 300_000, silver: 300_000, gold: 300_000 } })).toBeNull();
    expect(shortRef('trp_01HZX9a7f')).toBe('9A7F');
  });
});

describe('one cash truth (P-05)', () => {
  it('"لازم تسلّم" is what counts against the cap; the bar and colour follow it, held cash only explains', () => {
    // The audit's courier: 68,500 held, 54,500 owed of a 75,000 cap → 73 %: amber, not a green 91 % bar.
    expect(cashTruth({ heldIqd: 68_500, owedIqd: 54_500, capIqd: 75_000, overCap: false })).toMatchObject({ tone: 'warning', over: false, leftIqd: 20_500, heldNote: { kind: 'own', amountIqd: 14_000 } });
    expect(cashTruth({ heldIqd: 68_500, owedIqd: 54_500, capIqd: 75_000, overCap: false }).share).toBeCloseTo(0.7267, 3);
    // After the job: 67,500 owed = 90 % → red, 7,500 left before offers stop.
    expect(cashTruth({ heldIqd: 82_500, owedIqd: 67_500, capIqd: 75_000, overCap: false })).toMatchObject({ tone: 'danger', over: false, leftIqd: 7_500 });
    // Over the cap: stopped, by how much.
    expect(cashTruth({ heldIqd: 90_000, owedIqd: 82_500, capIqd: 75_000, overCap: true })).toMatchObject({ tone: 'danger', over: true, overIqd: 7_500, leftIqd: 0, share: 1 });
    // A tuktuk owing commission beyond the cash he holds.
    expect(cashTruth({ heldIqd: 0, owedIqd: 1_200, capIqd: 75_000, overCap: false })).toMatchObject({ tone: 'success', heldNote: { kind: 'more', amountIqd: 1_200 } });
    expect(cashTruth({ heldIqd: 5_000, owedIqd: 5_000, capIqd: 75_000, overCap: false }).heldNote).toBeNull();
  });
});

describe('scorecard', () => {
  it('formats targets and places values on the bar', () => {
    expect(metricFormat('acceptance', 0.85)).toBe('\u206685%\u2069');
    expect(metricFormat('rating', 4.8)).toBe('4.8');
    const acc = { key: 'acceptance' as const, zeroAt: 0.5, fullAt: 0.85 };
    expect(metricPos(acc, 1)).toBe(1);
    expect(metricPos(acc, 0.85)).toBeGreaterThan(metricPos(acc, 0.745));
    expect(metricPos({ key: 'rating', zeroAt: 4, fullAt: 4.8 }, 3)).toBe(0);
  });

  it('points to the next tier; Gold also needs 100 jobs', () => {
    expect(nextTierProgress(62, 40)).toEqual({ key: 'partner.score_next_silver', points: 8 });
    expect(nextTierProgress(81, 40)).toEqual({ key: 'partner.score_next_gold', points: 4 });
    expect(nextTierProgress(90, 40)).toEqual({ key: 'partner.score_gold_trips', points: 0 });
    expect(nextTierProgress(90, 140)).toBeNull();
  });

  it('puts the index on a track of three equal tier steps', () => {
    expect(tierTrackShare(0)).toBe(0);
    expect(tierTrackShare(35)).toBeCloseTo(1 / 6);
    expect(tierTrackShare(70)).toBeCloseTo(1 / 3);
    expect(tierTrackShare(77.5)).toBeCloseTo(1 / 2);
    expect(tierTrackShare(85)).toBeCloseTo(2 / 3);
    expect(tierTrackShare(100)).toBe(1);
    expect(tierTrackShare(-5)).toBe(0);
    expect(tierTrackShare(120)).toBe(1);
  });

  it('counts month one: day n of 30 and the days until day 31', () => {
    expect(observation(9)).toEqual({ day: 9, share: 0.3, daysLeft: 22 });
    expect(observation(30).daysLeft).toBe(1);
  });
});

describe('documents', () => {
  it('lists the most urgent first and offers insurance as optional', () => {
    const rows = documentRows({
      documents: [doc('national_id_front', 'approved'), doc('licence', 'expiring', { daysToExpiry: 12 }), doc('vehicle_registration', 'rejected', { rejectReason: 'الصورة مو واضحة' }), doc('photo', 'pending')],
      missing: ['national_id_back'],
    });
    expect(rows.map((r) => [r.kind, r.status, r.required])).toEqual([
      ['vehicle_registration', 'rejected', true],
      ['national_id_back', 'missing', true],
      ['insurance', 'missing', false],
      ['licence', 'expiring', true],
      ['photo', 'pending', true],
      ['national_id_front', 'approved', true],
    ]);
  });

  it('sums up: blocked > action > review > ok', () => {
    expect(docsSummary({ documents: [doc('licence', 'expired')], missing: [], blocksOnline: true })).toBe('blocked');
    expect(docsSummary({ documents: [doc('licence', 'expiring')], missing: [], blocksOnline: false })).toBe('action');
    expect(docsSummary({ documents: [doc('photo', 'pending')], missing: [], blocksOnline: false })).toBe('review');
    expect(docsSummary({ documents: [doc('photo', 'approved')], missing: [], blocksOnline: false })).toBe('ok');
  });

  it('says the days left and what to do', () => {
    expect(expiryText(12, t)).toBe('باقي 12 يوم');
    expect(expiryText(1, t)).toBe('باقي يوم واحد');
    expect(expiryText(-3, t)).toBe('انتهى قبل 3 أيام');
    expect(expiryText(null, t)).toBeNull();
    expect(docAction('rejected')).toBe('partner.docs_reupload');
    expect(docAction('expired')).toBe('partner.docs_renew');
    expect(docAction('pending')).toBeNull();
    expect(expiryFromMonth(2027, 10).toISOString()).toBe('2027-10-31T20:59:59.999Z');
  });
});

describe('online gate', () => {
  it('picks the worst reason', () => {
    expect(gateKind(null)).toBeNull();
    expect(gateKind({ canGoOnline: true, reasons: [] })).toBeNull();
    expect(gateKind({ canGoOnline: false, reasons: [{ code: 'checkin_required', message_ar: '' }] })).toBe('checkin');
    expect(gateKind({ canGoOnline: false, reasons: [{ code: 'checkin_required', message_ar: '' }, { code: 'document_expired', message_ar: '' }] })).toBe('document');
    expect(gateKind({ canGoOnline: false, reasons: [{ code: 'document_expired', message_ar: '' }, { code: 'checkin_locked', message_ar: '' }] })).toBe('locked');
    // A pause after a safety report comes before everything else (lane E adds the code on the server).
    const paused = { code: 'staff_paused', message_ar: '' } as unknown as { code: 'checkin_locked'; message_ar: string };
    expect(gateKind({ canGoOnline: false, reasons: [{ code: 'checkin_locked', message_ar: '' }, paused] })).toBe('paused');
  });
});

describe('main photo (Ali, 2026-10-06)', () => {
  const latest = (status: 'pending' | 'approved' | 'rejected', rejectReason: string | null = null) => ({ documentId: 'd', status, url: '/files/up_2', submittedAt: NOW, reviewedAt: null, rejectReason });
  const approved = { url: '/files/up_1', approvedAt: NOW };
  const view = (state: MainPhotoView['state'], extra: Partial<MainPhotoView> = {}): MainPhotoView => ({ state, approved: null, latest: null, ...extra });

  it('says «تنتظر الموافقة» / «مقبولة» / «مرفوضة: السبب», or that there is none yet', () => {
    expect(mainPhotoStatus(view('none'), t)).toEqual({ label: 'ما عندك صورة بعد', tone: 'warning' });
    expect(mainPhotoStatus(view('pending', { latest: latest('pending') }), t)).toEqual({ label: 'تنتظر الموافقة', tone: 'info' });
    expect(mainPhotoStatus(view('approved', { approved, latest: latest('approved') }), t)).toEqual({ label: 'مقبولة', tone: 'success' });
    expect(mainPhotoStatus(view('rejected', { latest: latest('rejected', 'الوجه مو واضح') }), t)).toEqual({ label: 'مرفوضة: الوجه مو واضح', tone: 'danger' });
    expect(mainPhotoStatus(view('rejected', { latest: latest('rejected', 'الوجه مو واضح') }), t, { short: true }).label).toBe('مرفوضة');
    expect(mainPhotoStatus(undefined, t).label).toBe('ما عندك صورة بعد');
  });

  it('tells him what customers see while a new photo waits or was refused', () => {
    expect(mainPhotoNote(view('pending', { approved, latest: latest('pending') }))).toBe('partner.mainphoto_pending_keep');
    expect(mainPhotoNote(view('pending', { latest: latest('pending') }))).toBe('partner.mainphoto_pending_first');
    expect(mainPhotoNote(view('rejected', { approved, latest: latest('rejected', 'x') }))).toBe('partner.mainphoto_rejected_keep');
    expect(mainPhotoNote(view('approved', { approved }))).toBe('partner.mainphoto_customers_see');
    expect(mainPhotoNote(view('none'))).toBe('partner.mainphoto_customers_see_initial');
  });
});

describe('r4: how long he has driven here', () => {
  const now = Date.UTC(2026, 9, 7);
  it('says new, months, then years, and nothing without a date', () => {
    expect(memberSpan(new Date(now - 10 * 86_400_000), now)).toEqual({ unit: 'new', n: 0 });
    expect(memberSpan(new Date(now - 95 * 86_400_000), now)).toEqual({ unit: 'months', n: 3 });
    expect(memberSpan(new Date(now - 800 * 86_400_000), now)).toEqual({ unit: 'years', n: 2 });
    expect(memberSpan(null, now)).toBeNull();
  });
});

describe('his best (partner redesign e3 / e5)', () => {
  const t = createT('ar-IQ');
  it('parts of the day the Iraqi way', () => {
    expect([5, 11, 12, 14, 15, 17, 18, 23, 0, 3].map(dayPart)).toEqual(['morning', 'morning', 'noon', 'noon', 'afternoon', 'afternoon', 'night', 'night', 'night', 'night']);
  });
  it('«الخميس 7–11 بالليل»: the part said once when both ends share it, twice when not', () => {
    // The range sits in a right-to-left isolate (formatRange); compare the words.
    const plain = (x: string) => x.replace(/[\u2066-\u2069]/g, '');
    expect(plain(bestWindowLabel({ weekday: 4, fromHour: 19, toHour: 23 }, t))).toBe('الخميس 7–11 بالليل');
    expect(plain(bestWindowLabel({ weekday: 5, fromHour: 16, toHour: 20 }, t))).toBe('الجمعة 4 العصر – 8 بالليل');
    expect(plain(bestWindowLabel({ weekday: 0, fromHour: 22, toHour: 24 }, t))).toBe('الأحد 10–12 بالليل');
    expect(plain(bestWindowLabel({ weekday: 2, fromHour: 12, toHour: 15 }, t))).toBe('الثلاثاء 12–3 الظهر');
  });
  it('a job line\'s tip is the sum of its tip lines', () => {
    const c = (type: string, amountIqd: number) => ({ type, amountIqd, label_ar: '', label_en: '', memo: null }) as never;
    expect(jobTipIqd({ components: [c('delivery_fee', 2000), c('tip', 1000), c('tip', 500)] })).toBe(1500);
    expect(jobTipIqd({ components: [c('delivery_fee', 2000)] })).toBe(0);
  });
});

describe('the score in five parts (partner redesign a4 / f6)', () => {
  const m = (key: string, value: number | null, score: number, weight: number) => ({ key, value, score, weight }) as never;
  const metrics = [m('acceptance', 0.68, 0.514, 20), m('completion', 1, 1, 15), m('on_time', 0.7, 0.333, 20), m('rating', 4.6, 0.75, 15), m('cash_return', 0.99, 1, 5)];

  it('maxima add up to 100 and points to his index, biggest part first', () => {
    // index = 100 × (0.514·20 + 15 + 0.333·20 + 0.75·15 + 5) / 75 = 64.4 → 64
    const parts = scoreParts(metrics, 64);
    expect(parts.reduce((s, p) => s + p.max, 0)).toBe(100);
    expect(parts.reduce((s, p) => s + p.points, 0)).toBe(64);
    expect(parts.map((p) => p.key)).toEqual(['acceptance', 'on_time', 'completion', 'rating', 'cash_return']);
    expect(parts.find((p) => p.key === 'cash_return')).toMatchObject({ max: 6, points: 6 });
    expect(weakestPart(parts)?.key).toBe('on_time');
  });

  it('a part without data is left out of the 100; a near-full card has no weakest part', () => {
    const parts = scoreParts([m('acceptance', 0.9, 1, 20), m('completion', 1, 1, 15), m('on_time', null, 1, 20), m('rating', 4.8, 1, 15), m('cash_return', 0.96, 1, 5)], 100);
    expect(parts.filter((p) => !p.noData).reduce((s, p) => s + p.max, 0)).toBe(100);
    expect(parts.at(-1)).toMatchObject({ key: 'on_time', noData: true, max: 0 });
    expect(weakestPart(parts)).toBeNull();
  });
});

describe('account hub and home papers (partner redesign a1 / a3)', () => {
  const t = createT('ar-IQ');
  const doc = (kind: string, status: string, daysToExpiry: number | null) => ({ kind, status, daysToExpiry }) as never;
  it('home hears of papers only in their last 14 days, the soonest first', () => {
    expect(papersReminder({ documents: [doc('licence', 'expiring', 20)] })).toBeNull();
    expect(papersReminder({ documents: [doc('licence', 'expiring', 12), doc('vehicle_registration', 'expiring', 5), doc('insurance', 'approved', null)] })).toEqual({ kind: 'vehicle_registration', days: 5 });
    // Expired is the online gate's job, not a reminder.
    expect(papersReminder({ documents: [doc('licence', 'expired', -3)] })).toBeNull();
    expect(papersReminder(undefined)).toBeNull();
  });
  it('the papers and check-in pills say the one thing that matters', () => {
    const base = (documents: never[], missing: string[] = []) => ({ documents, missing, blocksOnline: false }) as never;
    expect(papersPill(base([doc('national_id_front', 'approved', null), doc('national_id_back', 'approved', null), doc('photo', 'approved', null)]), t)?.tone).toBe('success');
    expect(papersPill(base([doc('national_id_front', 'approved', null), doc('national_id_back', 'approved', null), doc('photo', 'approved', null), doc('licence', 'expiring', 12)]), t)).toEqual({ label: 'وحدة تخلص بعد 12 يوم', tone: 'warning' });
    expect(papersPill(base([doc('licence', 'rejected', null)]), t)?.tone).toBe('danger');
    expect(checkInPill({ verifiedToday: true, lockedOut: false, required: true }, t)?.tone).toBe('success');
    expect(checkInPill({ verifiedToday: false, lockedOut: true, required: true }, t)?.tone).toBe('danger');
    expect(checkInPill({ verifiedToday: false, lockedOut: false, required: false }, t)).toBeNull();
  });
});
