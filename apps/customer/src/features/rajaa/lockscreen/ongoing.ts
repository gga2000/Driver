/**
 * The boarding pass on the lock screen (customer audit d-8). Native resolves `ongoing.native.ts`
 * (Android ongoing notification through expo-notifications). This file is the web / test build:
 * a browser has no lock screen, so every call is a no-op and `supported` is false.
 */
import type { PassCard } from './content';

export interface OngoingLabels {
  channel: string;
  channelDesc: string;
  imHereGarage: string;
  imHerePoint: string;
}

export interface OngoingPassDevice {
  /** Android only (iOS needs a Live Activity extension: follow-up). */
  readonly supported: boolean;
  /** Posts the card now, or replaces it in place (same id). */
  show(card: PassCard, labels: OngoingLabels): Promise<void>;
  /** Posts the card at `at` (T−30) even if the app is closed; replaces an earlier schedule. */
  schedule(card: PassCard, at: Date, labels: OngoingLabels): Promise<void>;
  /** Removes the card (shown or scheduled). */
  dismiss(id: string): Promise<void>;
  /** "أني بالكراج" pressed on the card (the app comes to the front first). */
  onImHere(cb: (bookingId: string) => void): () => void;
}

export const ongoingPass: OngoingPassDevice = {
  supported: false,
  show: async () => undefined,
  schedule: async () => undefined,
  dismiss: async () => undefined,
  onImHere: () => () => undefined,
};
