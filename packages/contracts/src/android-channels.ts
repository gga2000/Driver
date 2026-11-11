import { z } from 'zod';
import type { MessageKey } from '@driver/i18n';

// Speed: its own file, apart from notify-io.ts, so the phone apps that create these channels at start do
// not carry the server's whole push / WhatsApp / SMS text catalogue (apps/customer/scripts/contracts-subset.cjs).
// Keep zod its only runtime import; notify-io.ts re-exports all of it.

/**
 * Android notification channels the apps create at start. `offers` rings loud with the custom
 * `offer.wav` (partner job offers, merchant new orders); `marketing` is silent and its server-side
 * preference is off by default.
 */
export const AndroidChannelId = z.enum(['offers', 'orders', 'chat', 'marketing']);
export type AndroidChannelId = z.infer<typeof AndroidChannelId>;

export interface AndroidChannelDef {
  id: AndroidChannelId;
  nameKey: MessageKey;
  descriptionKey?: MessageKey;
  /** expo-notifications `AndroidImportance` name. */
  importance: 'MAX' | 'HIGH' | 'DEFAULT' | 'LOW';
  /** Bundled sound file name (`offer.wav`), `default`, or null for silent. */
  sound: string | null;
  vibrationPattern: readonly number[] | null;
  /** Which apps create the channel. */
  apps: readonly ('customer' | 'partner' | 'merchant')[];
}

export const OFFER_SOUND = 'offer.wav';

export const ANDROID_CHANNELS: Readonly<Record<AndroidChannelId, AndroidChannelDef>> = {
  offers: { id: 'offers', nameKey: 'notify.channel.offers', descriptionKey: 'notify.channel.offers_desc', importance: 'MAX', sound: OFFER_SOUND, vibrationPattern: [0, 400, 200, 400, 200, 400], apps: ['partner', 'merchant'] },
  orders: { id: 'orders', nameKey: 'notify.channel.orders', importance: 'HIGH', sound: 'default', vibrationPattern: [0, 250], apps: ['customer', 'partner', 'merchant'] },
  chat: { id: 'chat', nameKey: 'notify.channel.chat', importance: 'HIGH', sound: 'default', vibrationPattern: [0, 150], apps: ['customer', 'partner', 'merchant'] },
  marketing: { id: 'marketing', nameKey: 'notify.channel.marketing', importance: 'LOW', sound: null, vibrationPattern: null, apps: ['customer'] },
};
