import { describe, expect, it } from 'vitest';
import { formatAmount, formatCountdown, formatIqd, MINUS, roundToStep } from '../format';
import { acceptRing, lateMeter } from './countdown';
import { summarizePrice, type PriceItem } from './price';
import { SEAT_ROWS, seatIds, seatsLeft, selectionPrice, toggleSeat, toggleWalkup, type SeatInfo } from './seats';
import { resolveSnaps, snapTarget } from './sheet';

const strip = (s: string) => s.replace(/[⁦⁩]/g, '');

describe('format', () => {
  it('groups thousands with commas and puts دينار after', () => {
    expect(formatAmount(19250)).toBe('19,250');
    expect(formatIqd(1000)).toBe('1,000 دينار');
    expect(formatAmount(500)).toBe('500');
  });
  it('uses U+2212 minus, isolated so it stays with the number in RTL', () => {
    const s = formatAmount(-1500);
    expect(strip(s)).toBe(`${MINUS}1,500`);
    expect(s.startsWith('⁦')).toBe(true);
  });
  it('rounds to the 250 step half-up', () => {
    expect(roundToStep(2850)).toBe(2750);
    expect(roundToStep(2875)).toBe(3000);
    expect(roundToStep(19250)).toBe(19250);
  });
  it('formats countdowns as m:ss, rounding up partial seconds', () => {
    expect(formatCountdown(116_000)).toBe('1:56');
    expect(formatCountdown(500)).toBe('0:01');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});

describe('seats', () => {
  const car: SeatInfo[] = [
    { id: 'front', state: 'free', premium: 2000 },
    { id: 'back_left', state: 'taken' },
    { id: 'back_middle', state: 'walkup' },
    { id: 'back_right', state: 'free' },
  ];

  it('layouts have 4, 6 and 7 passenger seats plus the driver', () => {
    expect(seatIds(4)).toHaveLength(4);
    expect(seatIds(6)).toHaveLength(6);
    expect(seatIds(7)).toHaveLength(7);
    for (const rows of Object.values(SEAT_ROWS)) {
      expect(rows[0]).toEqual(['driver', null, 'front']);
      for (const r of rows) expect(r).toHaveLength(3);
    }
  });
  it('selects a free seat and replaces it in single-seat mode', () => {
    expect(toggleSeat(car, [], 'front')).toEqual({ selection: ['front'], rejected: null });
    expect(toggleSeat(car, ['front'], 'back_right')).toEqual({ selection: ['back_right'], rejected: null });
  });
  it('tapping a selected seat deselects it', () => {
    expect(toggleSeat(car, ['front'], 'front')).toEqual({ selection: [], rejected: null });
  });
  it('rejects taken, walk-up and held seats with the reason', () => {
    expect(toggleSeat(car, [], 'back_left').rejected).toBe('taken');
    expect(toggleSeat(car, [], 'back_middle').rejected).toBe('walkup');
    expect(toggleSeat([{ id: 'front', state: 'held' }], [], 'front').rejected).toBe('held');
    expect(toggleSeat(car, ['front'], 'back_left').selection).toEqual(['front']);
  });
  it('enforces max in multi-seat mode', () => {
    const seven: SeatInfo[] = seatIds(7).map((id) => ({ id, state: 'free' }));
    let r = toggleSeat(seven, [], 'middle_left', 2);
    r = toggleSeat(seven, r.selection, 'middle_right', 2);
    expect(r.selection).toEqual(['middle_left', 'middle_right']);
    const over = toggleSeat(seven, r.selection, 'rear_left', 2);
    expect(over).toEqual({ selection: ['middle_left', 'middle_right'], rejected: 'max' });
  });
  it('rejects a free seat blocked for this viewer and leaves it out of seats left', () => {
    const blocked: SeatInfo[] = [
      { id: 'back_left', state: 'taken' },
      { id: 'back_middle', state: 'free', blocked: true },
      { id: 'back_right', state: 'free' },
    ];
    expect(toggleSeat(blocked, [], 'back_middle')).toEqual({ selection: [], rejected: 'blocked' });
    expect(toggleSeat(blocked, [], 'back_right').rejected).toBeNull();
    expect(seatsLeft(blocked)).toBe(1);
  });
  it('rejects seats that are not in the car', () => {
    expect(toggleSeat(car, [], 'rear_left').rejected).toBe('unknown');
  });
  it('walk-up marking toggles free ↔ walkup only', () => {
    expect(toggleWalkup(car, 'back_right').find((s) => s.id === 'back_right')!.state).toBe('walkup');
    expect(toggleWalkup(car, 'back_middle').find((s) => s.id === 'back_middle')!.state).toBe('free');
    expect(toggleWalkup(car, 'back_left').find((s) => s.id === 'back_left')!.state).toBe('taken');
  });
  it('counts seats left and prices the selection with the front premium', () => {
    expect(seatsLeft(car)).toBe(2);
    expect(selectionPrice(car, ['front'], 10000)).toBe(12000);
    expect(selectionPrice(car, ['back_right'], 10000)).toBe(10000);
  });
});

describe('price summary', () => {
  const items: PriceItem[] = [
    { key: 'subtotal', label: 'الأصناف', amount: 19000 },
    { key: 'delivery', label: 'التوصيل', amount: 1500 },
    { key: 'service_fee', label: 'رسوم الخدمة', amount: 500 },
    { key: 'street_pickup', label: 'تلاقينا بالشارع', amount: -250 },
    { key: 'promo', label: 'خصم', amount: -1500 },
    { key: 'distance', label: 'المسافة', amount: 750, shadow: true },
  ];
  it('sums shown lines only; shadow lines are excluded from the total', () => {
    const s = summarizePrice(items);
    expect(s.shown).toHaveLength(5);
    expect(s.shadow).toHaveLength(1);
    expect(s.subtotal).toBe(19250);
    expect(s.total).toBe(19250);
    expect(s.rounding).toBe(0);
    expect(s.shadowTotal).toBe(20000);
  });
  it('rounds to the step and exposes the rounding as its own line', () => {
    const s = summarizePrice([
      { key: 'base', label: 'base', amount: 2000 },
      { key: 'night', label: 'night', amount: 350 },
    ]);
    expect(s.total).toBe(2250);
    expect(s.rounding).toBe(-100);
    expect(s.subtotal + s.rounding).toBe(s.total);
  });
  it("trusts the server's total (floors/caps) and reconciles via rounding", () => {
    const s = summarizePrice([{ key: 'base', label: 'base', amount: 1200 }], { total: 1500 });
    expect(s.total).toBe(1500);
    expect(s.rounding).toBe(300);
  });
  it('never shows a negative total', () => {
    expect(summarizePrice([{ key: 'promo', label: 'p', amount: -900 }]).total).toBe(0);
  });
});

describe('countdown timing', () => {
  it('accept ring depletes over the duration and turns urgent for the last 5 s', () => {
    expect(acceptRing(1000, 1000, 20000)).toEqual({ remainingMs: 20000, elapsedFraction: 0, expired: false, urgent: false });
    const mid = acceptRing(11000, 1000, 20000);
    expect(mid.remainingMs).toBe(10000);
    expect(mid.elapsedFraction).toBe(0.5);
    expect(acceptRing(17000, 1000, 20000).urgent).toBe(true);
    const done = acceptRing(30000, 1000, 20000);
    expect(done).toMatchObject({ remainingMs: 0, expired: true, urgent: false, elapsedFraction: 1 });
  });
  it('clamps a clock that is behind the start', () => {
    expect(acceptRing(0, 1000, 15000).remainingMs).toBe(15000);
  });

  const cfg = { graceMs: 180_000, stepMs: 600_000, stepAmount: 1000, forfeitMs: 1_200_000 };
  it('late meter: grace first, nothing charged', () => {
    expect(lateMeter(60_000, cfg)).toMatchObject({ phase: 'grace', remainingMs: 120_000, amount: 0 });
  });
  it('late meter: every started 10-minute step is charged in full', () => {
    expect(lateMeter(180_000, cfg)).toMatchObject({ phase: 'metering', steps: 1, amount: 1000 });
    expect(lateMeter(180_000 + 599_000, cfg)).toMatchObject({ steps: 1, amount: 1000 });
    expect(lateMeter(180_000 + 600_000, cfg)).toMatchObject({ steps: 2, amount: 2000, remainingMs: 600_000 });
  });
  it('late meter: forfeits the seat at 20 minutes late and stops charging', () => {
    expect(lateMeter(180_000 + 1_200_000, cfg)).toMatchObject({ phase: 'forfeited', steps: 2, amount: 2000, remainingMs: 0 });
    expect(lateMeter(10_000_000, cfg).amount).toBe(2000);
  });
});

describe('sheet snapping', () => {
  it('resolves fractional detents against the container and sorts them', () => {
    expect(resolveSnaps([0.9, 140, 0.5], 800)).toEqual([140, 400, 720]);
  });
  it('snaps to the nearest detent, projecting flick velocity', () => {
    const snaps = [140, 400, 720];
    expect(snapTarget(380, 0, snaps)).toBe(400);
    expect(snapTarget(380, 2500, snaps)).toBe(140); // fast flick down
    expect(snapTarget(420, -2500, snaps)).toBe(720); // fast flick up
  });
});
