import { I18nManager } from 'react-native';

/**
 * RTL is the default layout (spec §2.11). Called once at app start; on first launch
 * React Native needs a reload for the direction change to take effect.
 */
export function enforceRtl(): void {
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  }
}
