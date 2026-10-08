import { Platform } from 'react-native';
import { DEV_TOOLS } from '@/lib/env';

export { batteryFamily, batterySteps, type BatteryFamily } from './battery-guide';

/**
 * This phone's maker (Android reports it); null elsewhere. Screenshot builds (`DEV_TOOLS`) on the
 * web read `?maker=` so the guide can be looked at without the phone.
 */
export function phoneMaker(): string | null {
  if (Platform.OS === 'android') {
    const c = Platform.constants as { Manufacturer?: string; Brand?: string };
    return [c.Manufacturer, c.Brand].filter(Boolean).join(' ') || null;
  }
  if (Platform.OS === 'web' && DEV_TOOLS && typeof globalThis.location !== 'undefined') {
    return new URLSearchParams(globalThis.location.search).get('maker');
  }
  return null;
}
