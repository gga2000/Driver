import { describe, expect, it } from 'vitest';
import type { LatePromise } from '@driver/contracts';
import { creditToastDue, promiseBar } from './late-promise';

const MIN = 60_000;
const PROMISED = new Date('2026-10-05T18:00:00Z').getTime();
const promise = (credit: LatePromise['credit'] = null): LatePromise => ({ afterMin: 20, creditIqd: 1000, deadlineAt: new Date(PROMISED + 20 * MIN), credit });

describe('promiseBar (audit d-5)', () => {
  it('stays empty before the promised time and fills with the clock up to the threshold', () => {
    expect(promiseBar(promise(), PROMISED - 5 * MIN)).toMatchObject({ progress: 0, elapsedMin: 0, credited: false, amountIqd: 1000 });
    expect(promiseBar(promise(), PROMISED + 5 * MIN)).toMatchObject({ progress: 0.25, elapsedMin: 5 });
    expect(promiseBar(promise(), PROMISED + 15 * MIN + 30_000)).toMatchObject({ elapsedMin: 15 });
    // Past the threshold but not posted yet: full, not "credited" — that is the server's word.
    expect(promiseBar(promise(), PROMISED + 26 * MIN)).toMatchObject({ progress: 1, elapsedMin: 20, credited: false });
  });

  it('once the server posted the credit it shows what came back', () => {
    const p = promise({ amountIqd: 1500, at: new Date(PROMISED + 21 * MIN) });
    expect(promiseBar(p, PROMISED + 21 * MIN)).toMatchObject({ progress: 1, credited: true, amountIqd: 1500 });
  });

  it('no promise, no bar', () => {
    expect(promiseBar(null, PROMISED)).toBeNull();
    expect(promiseBar(undefined, PROMISED)).toBeNull();
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
