import { describe, expect, it } from 'vitest';
import { SaveRegularTripInput } from '@driver/contracts';
import { draftProblem, emptyDraft, toInput } from './draft';
import { withDinnerSlot } from './logic';

const HOME = { zoneKey: 'centre', pin: { lat: 32.91, lng: 45.06 }, placeId: 'pl_home', label: 'البيت' };
const WORK = { zoneKey: 'street_30', pin: { lat: 32.92, lng: 45.07 }, placeId: 'pl_work', label: 'الدائرة' };

describe('regular trip draft', () => {
  it('a ride needs both ends, and two different ones', () => {
    const d = emptyDraft('ride');
    expect(draftProblem(d)).toBe('need_from');
    expect(draftProblem({ ...d, ride: { ...d.ride, pickup: HOME } })).toBe('need_to');
    expect(draftProblem({ ...d, ride: { ...d.ride, pickup: HOME, dropoff: HOME } })).toBe('same_places');
    expect(toInput(d)).toBeNull();
  });

  it('sends what the server takes: Sunday–Thursday 7:30, asked the evening before', () => {
    const d = emptyDraft('ride');
    const input = toInput({ ...d, ride: { ...d.ride, pickup: HOME, dropoff: WORK } });
    expect(input).toMatchObject({ days: [0, 1, 2, 3, 4], timeMin: 450, remind: 'evening', plan: { kind: 'ride', rideVertical: 'taxi', pickup: HOME, dropoff: WORK } });
    expect(SaveRegularTripInput.safeParse(input).success).toBe(true);
  });

  it('a الرجعة every Thursday; a morning ask on an early trip falls back to the evening', () => {
    const input = toInput({ ...emptyDraft('rajaa'), timeMin: 7 * 60, remind: 'morning' });
    expect(input).toMatchObject({ days: [4], remind: 'evening', plan: { kind: 'rajaa', corridorId: 'aziziyah_kut', direction: 'from_aziziyah' } });
    expect(SaveRegularTripInput.safeParse(input).success).toBe(true);
  });
});

describe('the «وياك» slot at checkout', () => {
  it("joins the day's slots in time order and replaces one at the same instant", () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 7, h - 3, m));
    const slots = [at(19), at(19, 30), at(20)].map((x) => ({ at: x, iftar: false }));
    const out = withDinnerSlot(slots, at(19, 40), (x) => ({ at: x, iftar: false }));
    expect(out.map((s) => [s.at.getUTCHours() + 3, s.at.getUTCMinutes(), s.dinner])).toEqual([
      [19, 0, false],
      [19, 30, false],
      [19, 40, true],
      [20, 0, false],
    ]);
    expect(withDinnerSlot(slots, at(19, 30), (x) => ({ at: x, iftar: false })).filter((s) => s.dinner)).toHaveLength(1);
    expect(withDinnerSlot(slots, null, (x) => ({ at: x, iftar: false })).some((s) => s.dinner)).toBe(false);
  });
});
