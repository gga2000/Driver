import { describe, expect, it } from 'vitest';
import { PHONE_BOOKING_ROLES } from '@driver/contracts';
import { NAV, visibleNav } from './nav';
import { callerPhone, filterPlaces, formatCallerPhone, missingParts, newBookingKey, statusTone, type PhoneBookingForm } from './phone-booking';

const PLACES = [
  { id: 'garage_bab1', name_ar: 'كراج البوابة ١', aliases_ar: ['كراج بغداد'] },
  { id: 'garage_souq', name_ar: 'كراج السوق', aliases_ar: ['السوق'] },
  { id: 'mp_jami_kabir', name_ar: 'باب الجامع الكبير', aliases_ar: ['الجامع الكبير', 'جامع'] },
  { id: 'mp_hadiqat_shasha', name_ar: 'حديقة الشاشة', aliases_ar: ['الحديقة', 'متنزه'] },
  { id: 'mp_kuliyat', name_ar: 'باب كلية التربية الأساسية', aliases_ar: ['الكلية'] },
];

const FORM: PhoneBookingForm = { phone: '0771 234 5678', name: 'أبو حسين', pickupId: 'garage_souq', dropoffId: 'mp_hadiqat_shasha', vertical: 'taxi', note: '' };

describe('Console › حجز بالتلفون — the caller’s number', () => {
  it('takes an Iraqi mobile however it was read out, as the API does', () => {
    expect(callerPhone('0771 234 5678')).toBe('+9647712345678');
    expect(callerPhone('+964 771 234 5678')).toBe('+9647712345678');
    expect(callerPhone('00964-771-234-5678')).toBe('+9647712345678');
    expect(callerPhone('٠٧٧١٢٣٤٥٦٧٨')).toBe('+9647712345678');
    expect(callerPhone('7712345678')).toBe('+9647712345678');
    expect(callerPhone('0123 456 7890')).toBeNull();
    expect(callerPhone('0771 234')).toBeNull();
  });

  it('shows it as 07XX XXX XXXX while typing, with Western digits', () => {
    expect(formatCallerPhone('07712345678')).toBe('0771 234 5678');
    expect(formatCallerPhone('+9647712345678')).toBe('0771 234 5678');
    expect(formatCallerPhone('٠٧٧١٢')).toBe('0771 2');
    expect(formatCallerPhone('0771234567899')).toBe('0771 234 5678');
  });
});

describe('Console › حجز بالتلفون — places', () => {
  it('finds a landmark by its name or another name people use, best first', () => {
    expect(filterPlaces(PLACES, 'الجامع').map((p) => p.id)).toEqual(['mp_jami_kabir']);
    expect(filterPlaces(PLACES, 'كراج').map((p) => p.id)).toEqual(['garage_bab1', 'garage_souq']);
    expect(filterPlaces(PLACES, 'بغداد').map((p) => p.id)).toEqual(['garage_bab1']);
    expect(filterPlaces(PLACES, 'حديقه').map((p) => p.id)).toEqual(['mp_hadiqat_shasha']);
    expect(filterPlaces(PLACES, 'مستشفى')).toEqual([]);
    expect(filterPlaces(PLACES, '', 3).map((p) => p.id)).toEqual(['garage_bab1', 'garage_souq', 'mp_jami_kabir']);
  });
});

describe('Console › حجز بالتلفون — the form', () => {
  it('says what is still missing before «احجز»', () => {
    expect(missingParts(FORM, true)).toEqual([]);
    expect(missingParts(FORM, false)).toEqual(['quote']);
    expect(missingParts({ ...FORM, phone: '0771', name: '  ' }, true)).toEqual(['phone', 'name']);
    expect(missingParts({ ...FORM, dropoffId: null }, false)).toEqual(['places']);
    expect(missingParts({ ...FORM, dropoffId: 'garage_souq' }, true)).toEqual(['places']);
  });

  it('makes a fresh retry key per booking attempt in the API’s format', () => {
    const a = newBookingKey(() => 0.5);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newBookingKey()).not.toBe(newBookingKey());
  });

  it('colours the status so a ride nobody took yet stands out', () => {
    expect(statusTone('searching')).toBe('warn');
    expect(statusTone('driver_coming')).toBe('live');
    expect(statusTone('done')).toBe('done');
    expect(statusTone('cancelled')).toBe('neutral');
  });

  it('is in the sidebar for support, dispatchers and admins only', () => {
    const item = NAV.find((i) => i.href === '/phone')!;
    expect(item).toMatchObject({ key: 'console.nav_phone', icon: 'phone', jump: 'b' });
    expect(item.roles).toEqual(PHONE_BOOKING_ROLES);
    const shown = (roles: string[]) => visibleNav(new Set(roles as never[]), true).flatMap((g) => g.items.map((i) => i.href));
    expect(shown(['support'])).toContain('/phone');
    expect(shown(['field_ops'])).not.toContain('/phone');
    expect(shown(['finance'])).not.toContain('/phone');
  });
});
