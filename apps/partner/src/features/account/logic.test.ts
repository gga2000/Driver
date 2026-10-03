import { describe, expect, it } from 'vitest';
import type { DriverDocumentView, EarningsJobLine } from '@driver/contracts';
import { createT } from '@driver/i18n';
import {
  breakdownRows,
  capTone,
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
    expect(rangeLabel('week', { from: new Date(week.getTime() - 14 * DAY), to: new Date(week.getTime() - 7 * DAY) }, NOW, t)).toBe('13 أيلول – 19 أيلول');
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

  it('colours the cap bar green → orange → amber → red, and names the next tier', () => {
    expect(capTone({ fill: 0.4, overCap: false })).toBe('success');
    expect(capTone({ fill: 0.65, overCap: false })).toBe('accent');
    expect(capTone({ fill: 0.85, overCap: false })).toBe('warning');
    expect(capTone({ fill: 1, overCap: true })).toBe('danger');
    expect(nextTierCap({ tier: 'bronze', capIqd: 75_000, byTier: { bronze: 75_000, silver: 150_000, gold: 300_000 } })).toEqual({ tier: 'silver', capIqd: 150_000 });
    expect(nextTierCap({ tier: 'gold', capIqd: 300_000, byTier: { bronze: 75_000, silver: 150_000, gold: 300_000 } })).toBeNull();
    expect(nextTierCap({ tier: 'bronze', capIqd: 300_000, byTier: { bronze: 300_000, silver: 300_000, gold: 300_000 } })).toBeNull();
    expect(shortRef('trp_01HZX9a7f')).toBe('9A7F');
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
    expect(expiryText(-3, t)).toBe('انتهى قبل 3 يوم');
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
  });
});
