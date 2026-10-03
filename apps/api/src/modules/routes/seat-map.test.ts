import { describe, expect, it } from 'vitest';
import { adjacencyViolation, hasFrontSeat, rowSeats, seatsOf, type Occupant } from './seat-map.js';

const o = (
  seatId: Occupant['seatId'],
  groupId: string,
  travellingAs: Occupant['travellingAs'],
): Occupant => ({ seatId, groupId, travellingAs });

describe('seat maps per vehicle (decisions §9: saloon 4, SUV 6, van 7)', () => {
  it('the same seat ids as the SeatMap component draws', () => {
    expect(seatsOf(4)).toEqual(['front', 'back_left', 'back_middle', 'back_right']);
    expect(seatsOf(6)).toEqual([
      'front',
      'middle_left',
      'middle_right',
      'rear_left',
      'rear_middle',
      'rear_right',
    ]);
    expect(seatsOf(7)).toEqual([
      'front',
      'middle_left',
      'middle_middle',
      'middle_right',
      'rear_left',
      'rear_middle',
      'rear_right',
    ]);
  });

  it('rows to book whole, and a front seat on every layout', () => {
    expect(rowSeats(4, 'back')).toEqual(['back_left', 'back_middle', 'back_right']);
    expect(rowSeats(4, 'rear')).toBeNull();
    expect(rowSeats(6, 'middle')).toEqual(['middle_left', 'middle_right']);
    expect(rowSeats(7, 'rear')).toEqual(['rear_left', 'rear_middle', 'rear_right']);
    expect([4, 6, 7].every((l) => hasFrontSeat(l as 4 | 6 | 7))).toBe(true);
  });
});

describe('travelling-as adjacency (decisions §9)', () => {
  it('a lone woman is never put in the middle between two male strangers', () => {
    expect(
      adjacencyViolation(4, [
        o('back_left', 'a', 'rijal'),
        o('back_right', 'b', 'rijal'),
        o('back_middle', 'c', 'nisa'),
      ]),
    ).toBe('back_middle');
  });

  it('…and vice versa: a lone man between two women strangers', () => {
    expect(
      adjacencyViolation(4, [
        o('back_left', 'a', 'nisa'),
        o('back_right', 'b', 'nisa'),
        o('back_middle', 'c', 'rijal'),
      ]),
    ).toBe('back_middle');
  });

  it('holds whichever seat was sold last (the side seat that would complete the sandwich is refused too)', () => {
    const before = [o('back_middle', 'w', 'nisa'), o('back_left', 'a', 'rijal')];
    expect(adjacencyViolation(4, before)).toBeNull();
    expect(adjacencyViolation(4, [...before, o('back_right', 'b', 'rijal')])).toBe('back_middle');
  });

  it('one neighbour from her own group (sisters, a family row) makes it fine', () => {
    expect(
      adjacencyViolation(4, [
        o('back_left', 'g', 'nisa'),
        o('back_middle', 'g', 'nisa'),
        o('back_right', 'b', 'rijal'),
      ]),
    ).toBeNull();
  });

  it('same declaration on both sides, a family declaration, or an empty side seat: no violation', () => {
    expect(
      adjacencyViolation(4, [
        o('back_left', 'a', 'nisa'),
        o('back_right', 'b', 'nisa'),
        o('back_middle', 'c', 'nisa'),
      ]),
    ).toBeNull();
    expect(
      adjacencyViolation(4, [
        o('back_left', 'a', 'rijal'),
        o('back_right', 'b', 'rijal'),
        o('back_middle', 'c', 'aila'),
      ]),
    ).toBeNull();
    expect(
      adjacencyViolation(4, [o('back_left', 'a', 'rijal'), o('back_middle', 'c', 'nisa')]),
    ).toBeNull();
  });

  it('an undeclared walk-up counts as a man next to a woman (conservative)', () => {
    expect(
      adjacencyViolation(4, [
        o('back_left', 'walkup:back_left', null),
        o('back_right', 'b', 'rijal'),
        o('back_middle', 'c', 'nisa'),
      ]),
    ).toBe('back_middle');
    expect(
      adjacencyViolation(4, [
        o('back_left', 'walkup:back_left', null),
        o('back_right', 'b', 'nisa'),
        o('back_middle', 'c', 'rijal'),
      ]),
    ).toBeNull();
  });

  it('applies to every three-across row: the van middle bench and the rear row; the SUV middle row has no middle seat', () => {
    expect(
      adjacencyViolation(7, [
        o('middle_left', 'a', 'rijal'),
        o('middle_right', 'b', 'rijal'),
        o('middle_middle', 'c', 'nisa'),
      ]),
    ).toBe('middle_middle');
    expect(
      adjacencyViolation(6, [
        o('rear_left', 'a', 'rijal'),
        o('rear_right', 'b', 'rijal'),
        o('rear_middle', 'c', 'nisa'),
      ]),
    ).toBe('rear_middle');
    expect(
      adjacencyViolation(6, [o('middle_left', 'a', 'rijal'), o('middle_right', 'b', 'rijal')]),
    ).toBeNull();
  });
});
