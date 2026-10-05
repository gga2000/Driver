import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Linking: { canOpenURL: vi.fn(), openURL: vi.fn() }, Platform: { OS: 'web' } }));
vi.mock('@/lib/storage', () => ({ storage: { getItem: async () => null, setItem: async () => undefined } }));

const { navLinks } = await import('./nav');
const pin = { lat: 32.9, lng: 45.06 };

describe('navLinks (maps program d3)', () => {
  it('Google Maps: the app on Android and iOS, the web page everywhere as a fallback', () => {
    expect(navLinks('google', pin, 'android')).toEqual({ native: 'google.navigation:q=32.900000,45.060000&mode=d', web: 'https://www.google.com/maps/dir/?api=1&destination=32.900000,45.060000&travelmode=driving' });
    expect(navLinks('google', pin, 'ios').native).toBe('comgooglemaps://?daddr=32.900000,45.060000&directionsmode=driving');
    expect(navLinks('google', pin, 'web').native).toBeNull();
  });

  it('Waze: its own scheme on phones, waze.com on the web', () => {
    expect(navLinks('waze', pin, 'android')).toEqual({ native: 'waze://?ll=32.900000,45.060000&navigate=yes', web: 'https://waze.com/ul?ll=32.900000,45.060000&navigate=yes' });
    expect(navLinks('waze', pin, 'web').native).toBeNull();
  });
});
