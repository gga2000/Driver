/**
 * Push on this device. Native resolves `push.native.ts` (expo-notifications: permission, Expo push
 * token, Android channels, listeners). This file is the web / test build: browsers get no Expo push
 * token, so the permission is kept in memory only (enough for the pre-prompt and the settings
 * screen to behave) and `token()` answers null — nothing is registered with the API.
 */
export type PushPermission = 'granted' | 'denied' | 'undetermined';

export interface PushToken {
  token: string;
  kind: 'expo';
  platform: 'ios' | 'android' | 'web';
}

/** What a notification carries in `data` (set by the API's notify module). */
export interface PushData {
  deliveryId?: string;
  template?: string;
  deepLink?: string;
  [key: string]: unknown;
}

export interface PushDevice {
  permission(): Promise<PushPermission>;
  /** Shows the OS prompt (only after our own pre-prompt said yes). */
  request(): Promise<PushPermission>;
  token(): Promise<PushToken | null>;
  /** Android channels (offers / orders / chat / marketing); a no-op elsewhere. */
  setupChannels(): Promise<void>;
  /** A notification arrived while the app is open. */
  onReceive(cb: (data: PushData) => void): () => void;
  /** The person tapped a notification. */
  onOpen(cb: (data: PushData) => void): () => void;
  openSettings(): Promise<void>;
}

let webPermission: PushPermission = 'undetermined';

export const pushDevice: PushDevice = {
  permission: async () => webPermission,
  request: async () => {
    webPermission = 'granted';
    return webPermission;
  },
  token: async () => null,
  setupChannels: async () => undefined,
  onReceive: () => () => undefined,
  onOpen: () => () => undefined,
  openSettings: async () => undefined,
};
