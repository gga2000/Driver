import { describe, expect, it } from 'vitest';
import type { GuaranteeWindowView } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { guaranteeLine, guaranteeLines, peakName } from './guarantee-logic';

const t = createT('ar-IQ');
const en = createT('en');

/** Sunday lunch (12:00–16:00 Baghdad), live, as `driverAccount.guarantee` sends it. */
function win(over: Partial<GuaranteeWindowView> = {}): GuaranteeWindowView {
  return {
    id: '2026-10-04:lunch',
    peak: 'lunch',
    from: new Date('2026-10-04T09:00:00Z'),
    to: new Date('2026-10-04T13:00:00Z'),
    status: 'live',
    offers: 4,
    accepted: 4,
    acceptance: 1,
    cancelsAfterAccept: 0,
    completedJobs: 1,
    earningsIqd: 1000,
    meets: { acceptance: true, cancels: true, jobs: false },
    qualified: false,
    jobsToGo: 2,
    topUpIqd: 0,
    paysOn: new Date('2026-10-10T21:00:00Z'),
    rule: { amountIqd: 10_000, minAcceptance: 0.85, maxCancelsAfterAccept: 1, minCompletedJobs: 3 },
    ...over,
  };
}

describe('shift guarantee lines (G-91, from the server only)', () => {
  it('live, jobs missing: "باقي طلبين" with the amount, plural by the jobs left', () => {
    expect(guaranteeLine(win(), t)).toEqual({ id: '2026-10-04:lunch', tone: 'progress', text: 'باقي طلبين على ضمان شفت الغدا: 10,000 دينار' });
    expect(guaranteeLine(win({ jobsToGo: 1, completedJobs: 2 }), t)?.text).toBe('باقي طلب واحد على ضمان شفت الغدا: 10,000 دينار');
    expect(guaranteeLine(win({ jobsToGo: 3, completedJobs: 0, offers: 0, accepted: 0, acceptance: null, meets: { acceptance: false, cancels: true, jobs: false } }), t)?.text).toBe('باقي 3 طلبات على ضمان شفت الغدا: 10,000 دينار');
    expect(guaranteeLine(win({ peak: 'dinner' }), en)?.text).toBe('2 more jobs for the dinner shift guarantee: 10,000 IQD');
  });

  it('live, acceptance below the line: says the line and his number (rounded down, never flattering)', () => {
    const w = win({ offers: 7, accepted: 5, acceptance: 5 / 7, meets: { acceptance: false, cancels: true, jobs: false } });
    expect(guaranteeLine(w, t)).toMatchObject({ tone: 'warning', text: 'ضمان شفت الغدا يحتاج قبول 85% · قبولك هسة 71%' });
    expect(guaranteeLine(win({ acceptance: 0.849, meets: { acceptance: false, cancels: true, jobs: false } }), t)?.text).toContain('قبولك هسة 84%');
  });

  it('live, out on cancels: says so (it cannot come back this shift)', () => {
    expect(guaranteeLine(win({ cancelsAfterAccept: 2, meets: { acceptance: true, cancels: false, jobs: false } }), t)).toMatchObject({ tone: 'warning', text: 'ضمان شفت الغدا ما ينحسب هالمرة: ألغيت بعد القبول أكثر من المسموح (1)' });
  });

  it('live, every condition met: topped up by Sunday unless he already earned above it', () => {
    const met = { completedJobs: 3, jobsToGo: 0, meets: { acceptance: true, cancels: true, jobs: true }, qualified: true };
    expect(guaranteeLine(win({ ...met, earningsIqd: 4000, topUpIqd: 6000 }), t)).toMatchObject({ tone: 'progress', text: 'ضمنت شفت الغدا: إذا ما وصلت 10,000 دينار لحد 4:00 م نكمّلها لك يوم الأحد' });
    expect(guaranteeLine(win({ ...met, earningsIqd: 12_000 }), t)).toMatchObject({ tone: 'earned', text: 'طلعت فوگ ضمان شفت الغدا (10,000 دينار)' });
  });

  it('ended: only a real top-up shows (waiting for Sunday, or paid); nothing earned → nothing', () => {
    expect(guaranteeLine(win({ status: 'ended', qualified: true, topUpIqd: 6500 }), t)).toMatchObject({ tone: 'earned', text: 'ضمان شفت الغدا: +6,500 دينار، تنزل بحسابك يوم الأحد' });
    expect(guaranteeLine(win({ status: 'paid', qualified: true, topUpIqd: 6500 }), t)).toMatchObject({ tone: 'paid', text: 'ضمان شفت الغدا: +6,500 دينار نزلت بحسابك' });
    expect(guaranteeLine(win({ status: 'ended', qualified: false }), t)).toBeNull();
    expect(guaranteeLine(win({ status: 'ended', qualified: true, topUpIqd: 0 }), t)).toBeNull();
  });

  it('the summary keeps only the shifts with something to say; an unknown peak reads شفت الذروة', () => {
    expect(guaranteeLines([win({ status: 'ended' }), win({ id: '2026-10-04:dinner', peak: 'dinner' })], t).map((l) => l.id)).toEqual(['2026-10-04:dinner']);
    expect(peakName('night', t)).toBe('شفت الذروة');
  });
});
