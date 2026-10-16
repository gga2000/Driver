import { describe, expect, it } from 'vitest';
import { batteryFamily, batterySteps } from './battery-guide';

describe('battery guide (CRIT3-01)', () => {
  it('knows the phones whose battery manager stops apps', () => {
    expect(batteryFamily('Xiaomi Redmi')).toBe('xiaomi');
    expect(batteryFamily('POCO')).toBe('xiaomi');
    expect(batteryFamily('realme')).toBe('oppo');
    expect(batteryFamily('TECNO MOBILE LIMITED')).toBe('transsion');
    expect(batteryFamily('INFINIX')).toBe('transsion');
    expect(batteryFamily('HUAWEI')).toBe('huawei');
    expect(batteryFamily('samsung')).toBe('samsung');
    expect(batteryFamily('Google Pixel')).toBeNull();
    expect(batteryFamily(null)).toBeNull();
  });

  it('gives three steps per family', () => {
    expect(batterySteps('xiaomi')).toEqual(['notify.battery.xiaomi_1', 'notify.battery.xiaomi_2', 'notify.battery.xiaomi_3']);
  });
});
