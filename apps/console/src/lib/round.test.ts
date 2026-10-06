import { describe, expect, it } from 'vitest';
import type { RoundStop } from '@driver/contracts';
import { codeValid, collectAmountProblem, courierRoundState, normalizeCode, parseAmount, printRows, receiptKey, roundProgress, stopDone } from './round';

const at = new Date('2026-10-05T20:10:00Z');
const stop = (seq: number, zone: string, couriers: RoundStop['couriers']): RoundStop => ({ seq, zoneKey: zone, zone_ar: zone, couriers, totalIqd: couriers.reduce((a, c) => a + c.heldIqd, 0), collectedIqd: couriers.reduce((a, c) => a + (c.collected?.amountIqd ?? 0), 0) });
const holding = (id: string, held: number, overCap = false) => ({ driverId: id, name: id, heldIqd: held, overCap, collected: null });
const taken = (id: string, amount: number, left = 0) => ({ driverId: id, name: id, heldIqd: left, overCap: false, collected: { amountIqd: amount, at, reference: 'D-AAAA-0001' } });

describe('cash round mode (S-K5)', () => {
  it('progress: "جمعنا 612,000 من 746,710" from the desk numbers, couriers still holding, done', () => {
    const stops = [stop(1, 'المركز', [taken('a', 400_000), holding('b', 84_710)]), stop(2, 'زاكور', [taken('c', 212_000), holding('d', 50_000)])];
    const p = roundProgress({ stops, totalIqd: 134_710, collectedIqd: 612_000, targetIqd: 746_710 });
    expect(p).toEqual({ collectedIqd: 612_000, targetIqd: 746_710, leftIqd: 134_710, pct: 82, couriersLeft: 2, done: false });
    expect(roundProgress({ stops: [stop(1, 'x', [taken('a', 10_000)])], totalIqd: 0, collectedIqd: 10_000, targetIqd: 10_000 })).toMatchObject({ pct: 100, done: true, couriersLeft: 0 });
    // An older desk without the round fields: nothing collected yet, the target is what is held.
    expect(roundProgress({ stops: [stop(1, 'x', [holding('a', 5_000)])], totalIqd: 5_000, collectedIqd: undefined, targetIqd: undefined })).toMatchObject({ collectedIqd: 0, targetIqd: 5_000, pct: 0, done: false });
    expect(roundProgress({ stops: [], totalIqd: 0, collectedIqd: 0, targetIqd: 0 })).toMatchObject({ pct: 0, done: false });
  });

  it('each courier: collected, partly collected, or still holding; a stop is done when nobody holds cash', () => {
    expect(courierRoundState(taken('a', 1))).toBe('collected');
    expect(courierRoundState(taken('a', 1, 500))).toBe('partial');
    expect(courierRoundState(holding('a', 500))).toBe('holding');
    expect(stopDone(stop(1, 'x', [taken('a', 1), taken('b', 2)]))).toBe(true);
    expect(stopDone(stop(1, 'x', [taken('a', 1), holding('b', 2)]))).toBe(false);
    expect(stopDone(stop(1, 'x', []))).toBe(false);
  });

  it('the receipt form: the code is 4 digits (Eastern digits folded), the amount is within what he holds', () => {
    expect(normalizeCode('٤٨٢١')).toBe('4821');
    expect(normalizeCode('48 21x9')).toBe('4821');
    expect(codeValid('4821')).toBe(true);
    expect(codeValid('482')).toBe(false);
    expect(parseAmount('34,900')).toBe(34_900);
    expect(parseAmount('٣٤٩٠٠')).toBe(34_900);
    expect(parseAmount('')).toBe(0);
    expect(collectAmountProblem(34_900, 34_900)).toBeNull();
    expect(collectAmountProblem(0, 34_900)).toBe('empty');
    expect(collectAmountProblem(35_000, 34_900)).toBe('too_much');
    expect(receiptKey('d1', 1_700_000_000_000, () => 0.5)).toMatch(/^console-round:d1:[0-9a-z]+:[0-9a-z]+$/);
  });

  it('the printed route: stop by stop, the ones still holding first, the stop named once', () => {
    const rows = printRows({ stops: [stop(1, 'المركز', [taken('a', 400_000), holding('b', 84_710, true)]), stop(2, 'زاكور', [holding('c', 50_000)])] });
    expect(rows.map((r) => [r.seq, r.firstOfStop, r.driverId, r.collected])).toEqual([
      [1, true, 'b', false],
      [1, false, 'a', true],
      [2, true, 'c', false],
    ]);
  });
});
