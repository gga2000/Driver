import { PARCEL_RULES, type CourierParcelView, type PartnerJobStop } from '@driver/contracts';
import type { PickedPhoto } from '@/features/account/photo';

/**
 * طرود on the courier's side: which part of the parcel panel shows at this stop. The server owns every
 * rule (the code check, the tries, the 150 m refusal, who pays); this only picks the step to draw.
 */
export type ParcelStage =
  /** At the sender's door: the pickup photo. */
  | 'pickup'
  /** He has it, on the way to the receiver: the code is asked at the door. */
  | 'to_door'
  /** At the receiver's door: type the receipt code (and «رفضت تستلم» under it). */
  | 'pin'
  /** Too many wrong codes: call support. */
  | 'locked'
  /** The code was right: the normal hand-over continues. */
  | 'verified'
  /** The receiver refused it: it goes back to the sender. */
  | 'refused'
  | 'none';

type StopLike = Pick<PartnerJobStop, 'type' | 'state'>;

export function parcelStage(view: Pick<CourierParcelView, 'refused' | 'pinVerified' | 'pinTriesLeft'>, stop: StopLike | null): ParcelStage {
  if (view.refused) return 'refused';
  if (!stop || stop.state === 'completed' || stop.state === 'skipped') return 'none';
  if (stop.type === 'pickup') return stop.state === 'arrived' ? 'pickup' : 'none';
  if (stop.type !== 'dropoff') return 'none';
  if (view.pinVerified) return 'verified';
  if (view.pinTriesLeft <= 0) return 'locked';
  return stop.state === 'arrived' ? 'pin' : 'to_door';
}

/** One key on the code pad: a digit while there is room, `back` takes the last one off. */
export function typePin(pin: string, key: string): string {
  if (key === 'back') return pin.slice(0, -1);
  if (!/^\d$/.test(key) || pin.length >= PARCEL_RULES.pinLength) return pin;
  return pin + key;
}

export function pinComplete(pin: string): boolean {
  return pin.length === PARCEL_RULES.pinLength && /^\d+$/.test(pin);
}

/** The pickup photo's state on this phone, per order (it survives the panel remounting between stops). */
export type PickupPhotoState =
  | { kind: 'none' }
  | { kind: 'uploading'; photo: PickedPhoto }
  /** On the parcel (`parcels.courier.pickupPhoto`); `photo` is null when only the server says so (another session). */
  | { kind: 'saved'; photo: PickedPhoto | null }
  /** The upload or saving it on the parcel failed; `uploadId` set = uploaded, only the save is retried. */
  | { kind: 'failed'; photo: PickedPhoto; uploadId?: string };
