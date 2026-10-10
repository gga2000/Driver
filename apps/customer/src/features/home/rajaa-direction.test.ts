import { describe, expect, it } from 'vitest';
import { rajaaHomeDirection } from './rajaa-direction';

const garages = [
  { id: 'mp_garage_nahdha', cityId: 'baghdad', nameAr: 'كراج النهضة', lat: 33.35, lng: 44.43 },
  { id: 'mp_garage_bab1', cityId: 'aziziyah', nameAr: 'كراج البوابة 1', lat: 32.9032, lng: 45.0578 },
];

describe('الرجعة home card direction (h10, D-09)', () => {
  it('points out of Aziziyah for someone whose deliver-to place is in town, at any hour', () => {
    expect(rajaaHomeDirection({ position: null, garages, hasAziziyahPlace: true, hour: 20 })).toEqual({ direction: 'from_aziziyah', cityId: 'baghdad' });
  });
  it('points home when the phone is in Baghdad, even with a place in Aziziyah', () => {
    expect(rajaaHomeDirection({ position: { lat: 33.34, lng: 44.42 }, garages, hasAziziyahPlace: true, hour: 9 })).toEqual({ direction: 'to_aziziyah', cityId: 'baghdad' });
  });
  it('leans outbound in the morning and back in the evening when nothing else is known', () => {
    expect(rajaaHomeDirection({ position: null, garages, hasAziziyahPlace: false, hour: 7 }).direction).toBe('from_aziziyah');
    expect(rajaaHomeDirection({ position: null, garages, hasAziziyahPlace: false, hour: 12 }).direction).toBe('to_aziziyah');
  });
});
