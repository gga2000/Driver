import { describe, expect, it } from 'vitest';
import type { BoardSeat } from '@driver/contracts';
import { seatFit } from './fit';

const seat = (id: BoardSeat['id'], state: BoardSeat['state'], blocked: BoardSeat['blocked'] = null): BoardSeat => ({ id, state, premiumIqd: 0, blocked });

describe('seatFit', () => {
  it('counts only the free seats this rider may take', () => {
    expect(seatFit({ seats: [seat('front', 'taken'), seat('back_left', 'free'), seat('back_middle', 'free', 'adjacency'), seat('back_right', 'free')] })).toEqual({ kind: 'fits', n: 2 });
  });

  it('says the last seat does not fit when every free seat is blocked for the rider', () => {
    expect(seatFit({ seats: [seat('front', 'taken'), seat('back_left', 'taken'), seat('back_middle', 'free', 'adjacency'), seat('back_right', 'taken')] })).toEqual({ kind: 'none_fit', free: 1, reason: 'adjacency' });
  });

  it('names a family-only car as the reason', () => {
    expect(seatFit({ seats: [seat('middle_left', 'free', 'family_only'), seat('middle_right', 'free', 'family_only')] })).toEqual({ kind: 'none_fit', free: 2, reason: 'family_only' });
  });

  it('is full when no seat is free (held and walk-up seats are not free)', () => {
    expect(seatFit({ seats: [seat('front', 'held'), seat('back_left', 'walkup'), seat('back_right', 'taken')] })).toEqual({ kind: 'full' });
  });
});

