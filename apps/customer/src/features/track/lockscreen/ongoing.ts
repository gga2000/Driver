/**
 * The live order on the lock screen (joy l1). Native resolves `ongoing.native.ts` (Android ongoing
 * notification through expo-notifications). This file is the web / test build: a browser has no lock
 * screen, so every call is a no-op and `supported` is false.
 */
import type { LiveNoticeCard } from './content';

export interface LiveNoticeLabels {
  channel: string;
  channelDesc: string;
}

export interface LiveNoticeDevice {
  /** Android only (iOS needs a Live Activity extension: designed, not built). */
  readonly supported: boolean;
  /** Posts the card now, or replaces it in place (same id). */
  show(card: LiveNoticeCard, labels: LiveNoticeLabels): Promise<void>;
  /** Removes the card. */
  dismiss(id: string): Promise<void>;
  /** An order push arrived while the app's JS runs (foreground or alive in the background). */
  onOrderPush(cb: (orderId: string | null) => void): () => void;
}

export const liveNotice: LiveNoticeDevice = {
  supported: false,
  show: async () => undefined,
  dismiss: async () => undefined,
  onOrderPush: () => () => undefined,
};
