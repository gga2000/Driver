/**
 * Key-value storage for the session and small device-local records.
 *
 * Web (and tests): `localStorage`, wrapped — private windows and blocked storage fall back to
 * memory, which only means "signed out after reload". Native resolves `storage.native.ts`
 * instead (expo-secure-store: Keychain / Android Keystore).
 *
 * Keys must match /^[\w.-]+$/ (SecureStore's rule) so the same key works on every platform.
 */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory storage: tests, and the fallback when the platform store is unavailable. */
export function createMemoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => {
      map.set(k, v);
    },
    removeItem: async (k) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map),
  };
}

function webLocalStorage(): Storage | null {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

const memory = createMemoryStorage();

export const storage: KeyValueStorage = {
  async getItem(key) {
    try {
      return webLocalStorage()?.getItem(key) ?? (await memory.getItem(key));
    } catch {
      return memory.getItem(key);
    }
  },
  async setItem(key, value) {
    try {
      const ls = webLocalStorage();
      if (ls) ls.setItem(key, value);
      else await memory.setItem(key, value);
    } catch {
      await memory.setItem(key, value);
    }
  },
  async removeItem(key) {
    try {
      webLocalStorage()?.removeItem(key);
    } catch {
      /* ignore */
    }
    await memory.removeItem(key);
  },
};
