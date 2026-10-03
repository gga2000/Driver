import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { DeviceInfo } from '@driver/contracts';
import { storage } from './storage';

const KEY = 'driver.merchant.device';
let cached: DeviceInfo | null = null;

function randomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * This install's device record for OTP rate limits and the unknown-device re-verification rule
 * (edge-case §7). The fingerprint is a random id minted once per install and kept in secure storage.
 */
export async function getDeviceInfo(): Promise<DeviceInfo> {
  if (cached) return cached;
  let fingerprint = await storage.getItem(KEY);
  if (!fingerprint || fingerprint.length < 8) {
    fingerprint = `merch-${randomId()}`;
    await storage.setItem(KEY, fingerprint);
  }
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  cached = { fingerprint, platform, appVersion: Constants.expoConfig?.version ?? undefined };
  return cached;
}
