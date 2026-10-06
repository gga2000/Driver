import { describe, expect, it } from 'vitest';
import type { LatePromise } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { creditToastDue, etaPastDeadline, promiseBar, promiseCopy } from './late-promise';

const MIN = 60_000;
const PROMISED = new Date('2026-10-05T18:00:00Z').getTime();
const promise = (credit: LatePromise['credit'] = null, patch: Partial<LatePromise> = {}): LatePromise => ({
  afterMin: 20,
  creditIqd: 1000,
  basis: 'delivery_fee',
  deadlineAt: new Date(PROMISED + 20 * MIN),
  credit,
  apologyAfterMin: 10,
  apology: null,
  ...patch,
});

describe('promiseBar (audit d-5)', () => {
  it('stays empty before the promised time and fills with the clock up to the threshold', () => {
    expect(promiseBar(promise(), PROMISED - 5 * MIN)).toMatchObject({ progress: 0, elapsedMin: 0, credited: false, apologized: false, amountIqd: 1000, basis: 'delivery_fee' });
    expect(promiseBar(promise(), PROMISED + 5 * MIN)).toMatchObject({ progress: 0.25, elapsedMin: 5 });
    expect(promiseBar(promise(), PROMISED + 15 * MIN + 30_000)).toMatchObject({ elapsedMin: 15 });
    // Past the threshold but not posted yet: full, not "credited" — that is the server's word.
    expect(promiseBar(promise(), PROMISED + 26 * MIN)).toMatchObject({ progress: 1, elapsedMin: 20, credited: false });
  });

  it('once the server posted the credit it shows what came back', () => {
    const p = promise({ amountIqd: 1500, at: new Date(PROMISED + 21 * MIN) });
    expect(promiseBar(p, PROMISED + 21 * MIN)).toMatchObject({ progress: 1, credited: true, amountIqd: 1500 });
  });

  it('says sorry once the server sent its apology; a free-delivery order keeps its fixed amount', () => {
    const sorry = promise(null, { apology: { at: new Date(PROMISED + 10 * MIN), etaAt: new Date(PROMISED + 24 * MIN) } });
    expect(promiseBar(sorry, PROMISED + 11 * MIN)).toMatchObject({ apologized: true, credited: false });
    expect(promiseBar(promise(null, { basis: 'flat', creditIqd: 1000 }), PROMISED)).toMatchObject({ basis: 'flat', amountIqd: 1000 });
  });

  it('no promise, no bar', () => {
    expect(promiseBar(null, PROMISED)).toBeNull();
    expect(promiseBar(undefined, PROMISED)).toBeNull();
  });
});

describe('etaPastDeadline', () => {
  it('only when the new ETA lands at or after the deadline and nothing was credited yet', () => {
    const bar = promiseBar(promise(), PROMISED + 10 * MIN);
    expect(etaPastDeadline(bar, new Date(PROMISED + 27 * MIN))).toBe(true);
    expect(etaPastDeadline(bar, new Date(PROMISED + 20 * MIN))).toBe(true);
    expect(etaPastDeadline(bar, new Date(PROMISED + 15 * MIN))).toBe(false);
    expect(etaPastDeadline(bar, null)).toBe(false);
    expect(etaPastDeadline(null, new Date(PROMISED + 27 * MIN))).toBe(false);
    const paid = promiseBar(promise({ amountIqd: 1000, at: new Date(PROMISED + 21 * MIN) }), PROMISED + 21 * MIN);
    expect(etaPastDeadline(paid, new Date(PROMISED + 27 * MIN))).toBe(false);
  });
});

describe('creditToastDue', () => {
  it('fires once per order, only when the credit is posted', () => {
    const credited = promise({ amountIqd: 1000, at: new Date(PROMISED + 21 * MIN) });
    expect(creditToastDue(new Set(), 'o1', promise())).toBe(false);
    expect(creditToastDue(new Set(), 'o1', credited)).toBe(true);
    expect(creditToastDue(new Set(['o1']), 'o1', credited)).toBe(false);
    expect(creditToastDue(new Set(['o1']), 'o2', credited)).toBe(true);
  });
});

describe('promiseCopy', () => {
  it('names the delivery fee only when the credit is the fee', () => {
    expect(promiseCopy('delivery_fee')).toMatchObject({ line: 'promise.line', checkoutHint: 'promise.checkout_hint', toast: 'promise.toast', receiptHint: 'promise.receipt_hint', noteLateCredit: 'track.note_late_credit' });
    expect(promiseCopy('flat')).toMatchObject({ line: 'promise.line_flat', checkoutHint: 'promise.checkout_hint_flat', barUntil: 'promise.bar_until_flat', barPast: 'promise.bar_past_flat', credited: 'promise.credited_flat', toast: 'promise.toast_flat', receiptHint: 'promise.receipt_hint_flat', noteLateCredit: 'track.note_late_credit_flat' });
  });

  it('the credit toast is the credit alone; the apology is its own line (c6a)', () => {
    const t = createT('ar-IQ');
    expect(t(promiseCopy('delivery_fee').toast, { amount: '1,000' })).toBe('رجعنالك 1,000 دينار رصيد');
    expect(t(promiseCopy('flat').toast, { amount: '1,000' })).toBe('حطينالك 1,000 دينار رصيد');
    expect(t('promise.toast_sorry')).toBe('آسفين على التأخير');
  });
});
