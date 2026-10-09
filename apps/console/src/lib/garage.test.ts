import { describe, expect, it } from 'vitest';
import type { DriverDepartureView, OverdueDeparture } from '@driver/contracts';
import { actionFor, isOver, routeLabel, seatDots, sortBoard, stateChip, vehicleLabel } from './garage';

const late = (reason: OverdueDeparture['reason'], actions: OverdueDeparture['actions']): OverdueDeparture => ({
  departureId: 'd1',
  corridorId: 'c_bgd',
  garageId: 'g1',
  driverId: 'p1',
  state: reason === 'driver_no_show' ? 'scheduled' : 'departed',
  reason,
  since: new Date('2026-10-08T07:00:00Z'),
  minutes: 25,
  riders: 3,
  actions,
});
const dep = (id: string, at: string, state: DriverDepartureView['state']) =>
  ({ id, state, departAt: new Date(at) }) as unknown as DriverDepartureView;

describe('garage board helpers', () => {
  it('names the route in the direction the car goes', () => {
    const c = { nameAr: 'العزيزية ⇄ بغداد' };
    expect(routeLabel(c, 'from_aziziyah')).toBe('العزيزية ← بغداد');
    expect(routeLabel(c, 'to_aziziyah')).toBe('بغداد ← العزيزية');
    expect(routeLabel(undefined, 'from_aziziyah')).toBe('');
  });
  it('says the car the way people do: model then colour', () => {
    expect(vehicleLabel({ modelKey: 'elantra', model: null, color: 'بيضة' })).toBe('النترا بيضة');
    expect(vehicleLabel({ modelKey: 'other', model: 'كيا ريو', color: null })).toBe('كيا ريو');
    expect(vehicleLabel({ modelKey: null, model: null, color: null })).toBe('');
  });
  it('a late run shows why it is late, over its state', () => {
    expect(stateChip('scheduled', late('driver_no_show', ['cancel']))).toEqual({ key: 'console.garage.late_no_show', tone: 'bad' });
    expect(stateChip('departed', late('not_arrived', ['arrive']))).toEqual({ key: 'console.garage.late_not_arrived', tone: 'warn' });
    expect(stateChip('boarding', undefined).key).toBe('console.garage.state_boarding');
    expect(stateChip('cancelled_low_fill', undefined).key).toBe('console.garage.state_cancelled');
  });
  it('offers the one way out the server allows', () => {
    expect(actionFor('scheduled', late('driver_no_show', ['cancel']))).toBe('cancel');
    expect(actionFor('departed', late('not_arrived', ['arrive']))).toBe('arrive');
    expect(actionFor('arrived', undefined)).toBe('close');
    expect(actionFor('departed', undefined)).toBeNull();
    expect(actionFor('scheduled', late('driver_no_show', []))).toBeNull();
  });
  it('live runs first by time, finished ones sink (latest first)', () => {
    const out = sortBoard([
      dep('closed_early', '2026-10-08T05:00:00Z', 'closed'),
      dep('later', '2026-10-08T09:00:00Z', 'scheduled'),
      dep('closed_late', '2026-10-08T06:00:00Z', 'cancelled_by_driver'),
      dep('sooner', '2026-10-08T08:00:00Z', 'boarding'),
    ]).map((d) => d.id);
    expect(out).toEqual(['sooner', 'later', 'closed_late', 'closed_early']);
    expect(isOver('arrived')).toBe(false);
  });
  it('draws one dot per seat: booked, walk-ups, holds, then free', () => {
    const fill = { seatsTotal: 7, booked: 2, held: 1, walkUps: 1, walkUpsCounted: 1, filled: 3, free: 3 };
    expect(seatDots({ fill })).toEqual(['booked', 'booked', 'walkup', 'held', 'free', 'free', 'free']);
  });
});
