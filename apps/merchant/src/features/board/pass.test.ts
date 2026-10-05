import { describe, expect, it } from 'vitest';
import type { BoardCourier, BoardOrder } from '@driver/contracts';
import { PASS_WAIT_WARN_MIN, passFirst, passState, waitingAtPass } from './pass';

const T0 = Date.parse('2026-10-05T17:00:00Z');
const at = (min: number) => new Date(T0 + min * 60_000);
const none: BoardCourier = { state: 'none', firstName: null, vehicleClass: null, etaMinutes: null, arrivedAt: null };
const arrived = (min: number, patch: Partial<BoardCourier> = {}): BoardCourier => ({ state: 'arrived', firstName: 'حيدر', vehicleClass: 'bike', etaMinutes: null, arrivedAt: at(min), plate: 'واسط 45671', ...patch });

function ready(id: string, courier: BoardCourier, handedOverAt: Date | null = null) {
  return { id, column: 'ready', courier, handedOverAt } as Pick<BoardOrder, 'id' | 'column' | 'courier' | 'handedOverAt'>;
}

describe('the courier at the pass (S-M4)', () => {
  it('a ready card turns into the pass card when its courier is at the counter: green, then amber after 3 min', () => {
    expect(passState(ready('a', none), T0)).toBeNull();
    expect(passState(ready('a', { ...none, state: 'on_the_way', etaMinutes: 2 }), T0)).toBeNull();
    expect(passState(ready('a', arrived(0)), T0 + 60_000)).toEqual({ kind: 'at_pass', tone: 'success', waitedMin: 1, name: 'حيدر', plate: 'واسط 45671' });
    expect(passState(ready('a', arrived(0)), T0 + PASS_WAIT_WARN_MIN * 60_000)).toMatchObject({ tone: 'warning', waitedMin: 3 });
    expect(passState(ready('a', arrived(0)), T0 + 4 * 60_000 + 59_000)).toMatchObject({ tone: 'warning', waitedMin: 4 });
  });

  it('no name or plate: "الدليفري", and no plate chip', () => {
    expect(passState(ready('a', arrived(0, { firstName: '  ', plate: null })), T0)).toMatchObject({ name: null, plate: null });
  });

  it('only on the ready column; after "سلّمته" it says when, until he confirms the pickup', () => {
    expect(passState({ ...ready('a', arrived(0)), column: 'preparing' }, T0)).toBeNull();
    expect(passState(ready('a', arrived(0), at(2)), T0 + 3 * 60_000)).toEqual({ kind: 'handed', at: at(2), name: 'حيدر' });
  });

  it('the ready column reads: waiting couriers first (longest wait first), then handed over, then the rest', () => {
    const list = [ready('plain', none), ready('handed', arrived(1), at(3)), ready('late', arrived(-6)), ready('fresh', arrived(2))];
    expect(passFirst(list, T0 + 4 * 60_000).map((o) => o.id)).toEqual(['late', 'fresh', 'handed', 'plain']);
    expect(waitingAtPass(list, T0 + 4 * 60_000).map((o) => o.id)).toEqual(['late', 'fresh']);
  });
});
