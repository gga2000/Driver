import * as SecureStore from 'expo-secure-store';
import { createMemoryStorage, type KeyValueStorage } from './storage';

export { createMemoryStorage, type KeyValueStorage } from './storage';

/**
 * Native storage: expo-secure-store (iOS Keychain, Android Keystore-backed). Tokens never touch
 * plain AsyncStorage. A failing keystore (rare, e.g. after a device restore) degrades to memory,
 * which means the person signs in again — never a crash.
 */
const memory = createMemoryStorage();

export const storage: KeyValueStorage = {
  async getItem(key) {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return memory.getItem(key);
    }
  },
  async setItem(key, value) {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      await memory.setItem(key, value);
    }
  },
  async removeItem(key) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
    await memory.removeItem(key);
  },
};
