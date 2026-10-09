import { describe, expect, it } from 'vitest';
import { consoleNetwork, errorText } from './network';

describe('console network errors (K-06)', () => {
  it('never shows "Failed to fetch": no response reads as "can\'t reach the server", offline as offline', () => {
    expect(errorText(new TypeError('Failed to fetch'))).toBe('ما نگدر نوصل للسيرفر. نحاول كل 5 ثواني');
    consoleNetwork().setDeviceOnline(false);
    expect(errorText({ message: 'fetch failed' })).toBe('النت مقطوع. نحاول نرجع…');
    consoleNetwork().setDeviceOnline(true);
  });

  it('5xx names the status; other errors keep the server message', () => {
    expect(errorText({ message: 'Internal Server Error', data: { httpStatus: 502 } })).toBe('مشكلة بالسيرفر (502). جرّب بعد شوية');
    expect(errorText({ message: 'ما عندك صلاحية', data: { httpStatus: 403 } })).toBe('ما عندك صلاحية');
    expect(errorText({ message: '' })).toBe('صار خلل، جرب بعد شوية');
    expect(errorText(null)).toBe('');
  });
});
