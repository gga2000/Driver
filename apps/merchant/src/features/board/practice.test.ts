import { describe, expect, it } from 'vitest';
import { passState } from './pass';
import { isPractice, practiceOrder, practiceStep, PRACTICE_COURIER } from './practice';

const NAMES = { tikka: 'تكة لحم', soup: 'شوربة عدس', samoon: 'صمون', spicy: 'حار', note: 'عندي حساسية من السمسم' };
const T0 = Date.UTC(2026, 9, 8, 9, 0);

describe('practice order', () => {
  it('starts as a new, ringing order with the real 90 s window, marked as practice', () => {
    const o = practiceOrder(T0, NAMES);
    expect(isPractice(o.id)).toBe(true);
    expect(isPractice('ord_123')).toBe(false);
    expect(o.column).toBe('new');
    expect(o.acceptBy?.getTime()).toBe(T0 + 90_000);
    expect(o.note).toContain('حساسية');
  });

  it('walks accept → ready → courier at the pass → handed over, like a real order', () => {
    let o = practiceOrder(T0, NAMES);
    o = practiceStep(o, { kind: 'accept', prepMinutes: 15 }, T0 + 10_000);
    expect(o.column).toBe('preparing');
    expect(o.promisedReadyAt?.getTime()).toBe(T0 + 10_000 + 15 * 60_000);
    o = practiceStep(o, { kind: 'courier_coming' }, T0 + 12_000);
    expect(o.courier.state).toBe('on_the_way');
    expect(o.courier.pickupCode).toBe(PRACTICE_COURIER.pickupCode);
    o = practiceStep(o, { kind: 'ready' }, T0 + 60_000);
    expect(o.column).toBe('ready');
    o = practiceStep(o, { kind: 'courier_arrived' }, T0 + 64_000);
    expect(passState(o, T0 + 64_000)?.kind).toBe('at_pass');
    o = practiceStep(o, { kind: 'hand_over' }, T0 + 70_000);
    expect(passState(o, T0 + 70_000)?.kind).toBe('handed');
  });

  it('ignores steps out of turn and gives +5 only once', () => {
    const fresh = practiceOrder(T0, NAMES);
    expect(practiceStep(fresh, { kind: 'ready' }, T0)).toBe(fresh);
    expect(practiceStep(fresh, { kind: 'hand_over' }, T0)).toBe(fresh);
    const cooking = practiceStep(fresh, { kind: 'accept', prepMinutes: 20 }, T0);
    const once = practiceStep(cooking, { kind: 'extend' }, T0);
    expect(once.promisedReadyAt!.getTime() - cooking.promisedReadyAt!.getTime()).toBe(5 * 60_000);
    expect(practiceStep(once, { kind: 'extend' }, T0)).toBe(once);
  });
});
