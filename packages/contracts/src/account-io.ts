import { z } from 'zod';
import { t, type Locale, type MessageKey } from '@driver/i18n';
import { CityId, Iqd, LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { orderTicketNumber } from './order.js';

/**
 * Customer account surfaces (customer spec §9–10): saved places, the wallet (money, points,
 * transactions, top-up) and households. Schemas and the three transport ports the API implements
 * (`modules/places`, `modules/ledger`, `modules/orgs`). Every procedure acts on the caller's own data.
 */

// ───────────────────────── places (domain §7) ─────────────────────────

/** home / work are one each per person (saving a second demotes the older to custom). */
export const SavedPlaceLabel = z.enum(['home', 'work', 'custom']);
export type SavedPlaceLabel = z.infer<typeof SavedPlaceLabel>;

/** Domain §7: "موقعك مؤكد ✓" from this confidence up. */
export const PLACE_CONFIRMED_CONFIDENCE = 0.8;
export const PLACE_MAX_PHOTOS = 4;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PhotoContentType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type PhotoContentType = z.infer<typeof PhotoContentType>;

/** A gate/door photo. `url` may be relative to the API origin (dev storage) or absolute (object storage). */
export const PlacePhotoRef = z.object({ id: z.string(), url: z.string().min(1) });
export type PlacePhotoRef = z.infer<typeof PlacePhotoRef>;

/**
 * A landmark by its names (maps program a2): what a saved place shows for the landmark it is near,
 * and the head of every `LandmarkView`.
 */
export const PlaceLandmark = z.object({ id: z.string(), name_ar: z.string(), name_en: z.string() });
export type PlaceLandmark = z.infer<typeof PlaceLandmark>;

export const SavedPlaceView = z.object({
  id: z.string(),
  cityId: z.string(),
  label: SavedPlaceLabel,
  name: z.string(),
  /** Resolved by the server from the pin; never trusted from the client. */
  zoneId: z.string(),
  zoneName_ar: z.string(),
  zoneName_en: z.string(),
  pin: LatLng,
  /** Courier hint ("باب أخضر يم الجامع"); shown to the assigned courier only during the trip. */
  note: z.string().nullable(),
  photos: z.array(PlacePhotoRef),
  confidence: z.number().min(0).max(1),
  /** confidence ≥ PLACE_CONFIRMED_CONFIDENCE: the "موقعك مؤكد ✓" badge. */
  confirmed: z.boolean(),
  /** Last time the owner stood there and tapped "موقعي هنا". */
  confirmedAt: z.coerce.date().nullable(),
  /**
   * Couriers' arrivals agree on where the door is ("الباب مأكّد", maps program a3): couriers navigate
   * to that door from now on. The pin above stays the customer's own.
   */
  doorConfirmed: z.boolean(),
  /** Which gate couriers go in by (maps program a4), marked by the owner; null = the pin itself. */
  entrance: LatLng.nullable(),
  /**
   * The landmark the owner said the place is near (maps program a2, "قرب الجامع الكبير"); the courier
   * on the job reads it too. Null when none was chosen or the landmark is gone.
   */
  landmark: PlaceLandmark.nullable(),
  sharedWithHousehold: z.boolean(),
  /** owner = mine (editable); household = a household member shared it with me (read-only). */
  access: z.enum(['owner', 'household']),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type SavedPlaceView = z.infer<typeof SavedPlaceView>;

const PlaceName = z.string().trim().min(1).max(60);
const PlaceNote = z.string().trim().max(300);

export const SavePlaceInput = z.object({
  cityId: CityId.default('aziziyah'),
  label: SavedPlaceLabel,
  name: PlaceName,
  pin: LatLng,
  note: PlaceNote.optional(),
  /** Finished uploads from `places.photoUpload` (owner-checked). */
  photoIds: z.array(z.string().min(1)).max(PLACE_MAX_PHOTOS).default([]),
  shareWithHousehold: z.boolean().default(false),
  /** Which gate (maps program a4): where couriers go in, within `PLACE_ENTRANCE_MAX_M` of the pin. */
  entrance: LatLng.optional(),
  /** Near which landmark (maps program a2): one of `places.landmarksNear` for this pin. */
  landmarkId: z.string().min(1).max(64).optional(),
  /** Client idempotency key (device-place migration): saving the same ref twice returns the first place. */
  clientRef: z.string().min(1).max(64).optional(),
});
export type SavePlaceInput = z.input<typeof SavePlaceInput>;

export const UpdatePlaceInput = z.object({
  placeId: z.string().min(1),
  label: SavedPlaceLabel.optional(),
  name: PlaceName.optional(),
  /** Moving the pin re-resolves the zone and resets confidence to "unconfirmed". */
  pin: LatLng.optional(),
  note: PlaceNote.nullable().optional(),
  photoIds: z.array(z.string().min(1)).max(PLACE_MAX_PHOTOS).optional(),
  shareWithHousehold: z.boolean().optional(),
  /** Which gate (a4); null removes it. */
  entrance: LatLng.nullable().optional(),
  /** Near which landmark (a2), checked against the place's pin after this edit; null removes it. */
  landmarkId: z.string().min(1).max(64).nullable().optional(),
});
export type UpdatePlaceInput = z.input<typeof UpdatePlaceInput>;

/**
 * A gate this far from the pin belongs to another house (maps program a4): refused when saved
 * (`place_entrance_too_far`), forgotten when the pin itself moves that far.
 */
export const PLACE_ENTRANCE_MAX_M = 150;

/**
 * "قرب شنو؟" (maps program a2): a landmark farther than this from the pin does not help a courier find
 * the house, so it is not offered, refused when saved (`place_landmark_invalid`) and forgotten when
 * the pin itself moves that far. 500 m is a short walk: the courier sees the mosque, then asks.
 */
export const PLACE_LANDMARK_MAX_M = 500;
/** At most this many landmark chips: more turns a quick tap into reading a list. */
export const PLACE_LANDMARK_CHOICES = 5;

export const PlaceIdInput = z.object({ placeId: z.string().min(1) });
export type PlaceIdInput = z.infer<typeof PlaceIdInput>;

/** Domain §7: a fix this close to the saved pin agrees with it. */
export const PLACE_AGREE_RADIUS_M = 40;
/** A GPS fix worse than this cannot confirm a place. */
export const PLACE_CONFIRM_MAX_ACCURACY_M = 60;

/**
 * "موقعي هنا": the owner at the door with the device's GPS fix. Within 40 m of the saved pin the two
 * agree and the place is confirmed; farther, the pin moves to the fix (the owner is the authority on
 * his own door — courier taps never move a pin) and the zone is re-resolved.
 */
export const ConfirmPlaceInput = z.object({ placeId: z.string().min(1), pin: LatLng, accuracyM: z.number().nonnegative().optional() });
export type ConfirmPlaceInput = z.infer<typeof ConfirmPlaceInput>;

export const ZoneForPinInput = z.object({ cityId: CityId.default('aziziyah'), pin: LatLng });
export type ZoneForPinInput = z.input<typeof ZoneForPinInput>;
export const ZoneForPinOutput = z.object({ zoneId: z.string().nullable(), zoneName_ar: z.string().nullable(), zoneName_en: z.string().nullable(), inService: z.boolean() });
export type ZoneForPinOutput = z.infer<typeof ZoneForPinOutput>;

/** "وين رايح؟": the city's landmarks (seeded garages and meeting points + verified landmark places). */
export const RiderLandmarksInput = z.object({ cityId: CityId.default('aziziyah') });
export type RiderLandmarksInput = z.input<typeof RiderLandmarksInput>;
export const LandmarkView = PlaceLandmark.extend({
  pin: LatLng,
  zoneId: z.string(),
  kind: z.enum(['garage', 'meeting_point', 'landmark']),
  aliases_ar: z.array(z.string()).default([]),
  photoUrl: z.string().nullable().default(null),
});
export type LandmarkView = z.infer<typeof LandmarkView>;

/** "قرب شنو؟": landmarks near a pin the customer is saving (maps program a2). */
export const LandmarksNearInput = z.object({ cityId: CityId.default('aziziyah'), pin: LatLng });
export type LandmarksNearInput = z.input<typeof LandmarksNearInput>;
/**
 * Up to `PLACE_LANDMARK_CHOICES` landmarks within `PLACE_LANDMARK_MAX_M` of the pin, nearest first.
 * `distanceM` is whole metres; the app formats it (Western digits).
 */
export const LandmarkNearView = LandmarkView.extend({ distanceM: z.number().int().nonnegative() });
export type LandmarkNearView = z.infer<typeof LandmarkNearView>;

export const PhotoUploadInput = z.object({ contentType: PhotoContentType, sizeBytes: z.number().int().positive().max(PHOTO_MAX_BYTES) });
export type PhotoUploadInput = z.infer<typeof PhotoUploadInput>;
/** Signed upload: PUT the bytes to `uploadUrl` (relative URLs resolve against the API origin) before it expires. */
export const PhotoUploadTicket = z.object({
  uploadId: z.string(),
  uploadUrl: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string()),
  expiresAt: z.coerce.date(),
  maxBytes: z.number().int(),
});
export type PhotoUploadTicket = z.infer<typeof PhotoUploadTicket>;

export interface PlacesPort {
  mine(actor: Actor): Promise<SavedPlaceView[]>;
  save(actor: Actor, input: z.infer<typeof SavePlaceInput>): Promise<SavedPlaceView>;
  update(actor: Actor, input: z.infer<typeof UpdatePlaceInput>): Promise<SavedPlaceView>;
  remove(actor: Actor, input: PlaceIdInput): Promise<{ ok: true }>;
  confirm(actor: Actor, input: ConfirmPlaceInput): Promise<SavedPlaceView>;
  zoneFor(input: z.infer<typeof ZoneForPinInput>): Promise<ZoneForPinOutput>;
  /** Optional so older contexts keep compiling; the router answers [] without it. */
  landmarks?(input: z.infer<typeof RiderLandmarksInput>): Promise<LandmarkView[]>;
  landmarksNear(input: z.infer<typeof LandmarksNearInput>): Promise<LandmarkNearView[]>;
  photoUpload(actor: Actor, input: PhotoUploadInput): Promise<PhotoUploadTicket>;
}

// ───────────────────────── wallet (domain §10, decisions §2) ─────────────────────────

export const WalletHouseholdBalance = z.object({ id: z.string(), name: z.string(), role: z.enum(['payer', 'orderer', 'member']), balanceIqd: Iqd });

export const WalletBalanceView = z.object({
  /** customer:<id>: positive = credit you can spend, negative = you owe (short cash). */
  moneyIqd: Iqd,
  points: z.number().int(),
  /** points × pointValueIqd (100 points = 1,000 IQD). */
  pointsWorthIqd: Iqd,
  /** Points friends earned for you before you joined (keyed by your number), waiting to be claimed. */
  pendingPoints: z.number().int().nonnegative(),
  pendingWorthIqd: Iqd,
  /** Pending points lapse 90 days after they were earned; the earliest lapse. */
  pendingExpiresAt: z.coerce.date().nullable(),
  pointValueIqd: Iqd,
  household: WalletHouseholdBalance.nullable(),
});
export type WalletBalanceView = z.infer<typeof WalletBalanceView>;

export const WalletLineKind = z.enum(['food', 'grocery', 'errand', 'ride', 'seat', 'subscription', 'parcel', 'purchase', 'topup', 'credit', 'refund', 'penalty', 'cash_change', 'change_to_wallet', 'late_credit', 'debt', 'adjustment', 'points']);
export type WalletLineKind = z.infer<typeof WalletLineKind>;

/** One readable line: a whole order (not its internal splits), a credit, or a points movement. */
export const WalletLine = z.object({
  id: z.string(),
  occurredAt: z.coerce.date(),
  book: z.enum(['money', 'points']),
  kind: WalletLineKind,
  title_ar: z.string(),
  title_en: z.string(),
  detail_ar: z.string().nullable(),
  detail_en: z.string().nullable(),
  /** Signed: + in, − out. IQD or points per `unit`. */
  amount: z.number().int(),
  unit: z.enum(['iqd', 'points']),
  /** How a purchase was paid. */
  method: z.enum(['cash', 'wallet']).nullable(),
  orderId: z.string().optional(),
  tripId: z.string().optional(),
});
export type WalletLine = z.infer<typeof WalletLine>;

export const WalletTransactionsInput = z.object({ limit: z.number().int().min(1).max(100).default(30), before: z.coerce.date().optional() });
export type WalletTransactionsInput = z.input<typeof WalletTransactionsInput>;
export const WalletTransactionsView = z.object({ lines: z.array(WalletLine), nextBefore: z.coerce.date().nullable() });
export type WalletTransactionsView = z.infer<typeof WalletTransactionsView>;

export const TopupAgent = z.object({
  id: z.string(),
  name_ar: z.string(),
  name_en: z.string(),
  zoneId: z.string(),
  zoneName_ar: z.string(),
  zoneName_en: z.string(),
  pin: LatLng,
  hours_ar: z.string(),
  hours_en: z.string(),
});
export const TopupChannel = z.object({
  id: z.enum(['agent', 'driver', 'zaincash']),
  available: z.boolean(),
  title_ar: z.string(),
  title_en: z.string(),
  body_ar: z.string(),
  body_en: z.string(),
});
export const TopupOptionsView = z.object({
  channels: z.array(TopupChannel),
  agents: z.array(TopupAgent),
  /** True while the agent list is a placeholder (no agent network signed yet). */
  placeholder: z.boolean(),
});
export type TopupOptionsView = z.infer<typeof TopupOptionsView>;

/** Arabic (default) or English title of a wallet line kind (`wallet.line.<kind>` in packages/i18n). */
export function walletLineTitle(kind: WalletLineKind, locale: Locale = 'ar-IQ'): string {
  return t(`wallet.line.${kind}` as MessageKey, undefined, locale);
}

/** The order a wallet line belongs to, as the customer knows it: "طلب #3808". */
export function walletOrderDetail(orderId: string, locale: Locale = 'ar-IQ'): string {
  return t('order.number', { id: orderTicketNumber(orderId) }, locale);
}

/** Wallet line details (`wallet.detail.<key>`). */
export function walletLineDetail(key: 'cash' | 'wallet' | 'cash_change' | 'change_to_wallet' | 'short_cash', locale: Locale = 'ar-IQ'): string {
  return t(`wallet.detail.${key}` as MessageKey, undefined, locale);
}

export const ClaimPointsOutput = z.object({ claimed: z.number().int().nonnegative(), points: z.number().int() });
export type ClaimPointsOutput = z.infer<typeof ClaimPointsOutput>;

export interface WalletPort {
  balance(actor: Actor): Promise<WalletBalanceView>;
  transactions(actor: Actor, input: z.infer<typeof WalletTransactionsInput>): Promise<WalletTransactionsView>;
  topupOptions(actor: Actor): Promise<TopupOptionsView>;
  /** Moves the pending points keyed by the caller's verified number into his points (`points_claimed`). */
  claimPoints(actor: Actor): Promise<ClaimPointsOutput>;
}

// ───────────────────────── households (domain §12) ─────────────────────────

export const HouseholdRole = z.enum(['payer', 'orderer', 'member']);
export type HouseholdRole = z.infer<typeof HouseholdRole>;

export const HouseholdMemberView = z.object({
  personId: z.string(),
  /** From the vault (read logged, purpose household_view); null when the member set none. */
  name: z.string().nullable(),
  phoneMasked: z.string(),
  role: HouseholdRole,
  spendingLimitIqd: Iqd.nullable(),
  isMe: z.boolean(),
});
export type HouseholdMemberView = z.infer<typeof HouseholdMemberView>;

export const PayerApprovalView = z.object({
  id: z.string(),
  householdId: z.string(),
  orderId: z.string(),
  requestedBy: z.string(),
  requestedByName: z.string().nullable(),
  amountIqd: Iqd,
  /** The requester's current spending limit (null = none). */
  limitIqd: Iqd.nullable(),
  state: z.enum(['pending', 'approved', 'declined']),
  state_ar: z.string(),
  createdAt: z.coerce.date(),
  /** True when the caller is a payer and the request is pending. */
  canResolve: z.boolean(),
});
export type PayerApprovalView = z.infer<typeof PayerApprovalView>;

export const HouseholdView = z.object({
  id: z.string(),
  name: z.string(),
  cityId: z.string(),
  myRole: HouseholdRole,
  members: z.array(HouseholdMemberView),
  /** Payers see every pending request; other members see their own. */
  pendingApprovals: z.array(PayerApprovalView),
});
export type HouseholdView = z.infer<typeof HouseholdView>;

export const CreateHouseholdInput = z.object({ name: z.string().trim().min(1).max(60), cityId: CityId.default('aziziyah') });
export type CreateHouseholdInput = z.input<typeof CreateHouseholdInput>;
export const InviteMemberInput = z.object({
  householdId: z.string().min(1),
  phone: z.string().min(7).max(20),
  role: HouseholdRole.exclude(['payer']).default('orderer'),
  spendingLimitIqd: Iqd.nonnegative().nullable().default(null),
});
export type InviteMemberInput = z.input<typeof InviteMemberInput>;
export const SetLimitInput = z.object({ householdId: z.string().min(1), personId: z.string().min(1), spendingLimitIqd: Iqd.nonnegative().nullable() });
export type SetLimitInput = z.infer<typeof SetLimitInput>;
export const HouseholdIdInput = z.object({ householdId: z.string().min(1) });
export type HouseholdIdInput = z.infer<typeof HouseholdIdInput>;
export const ApprovalIdInput = z.object({ requestId: z.string().min(1) });
export type ApprovalIdInput = z.infer<typeof ApprovalIdInput>;

export interface HouseholdsPort {
  mine(actor: Actor): Promise<HouseholdView | null>;
  create(actor: Actor, input: z.infer<typeof CreateHouseholdInput>): Promise<HouseholdView>;
  inviteMember(actor: Actor, input: z.infer<typeof InviteMemberInput>): Promise<HouseholdView>;
  setLimit(actor: Actor, input: SetLimitInput): Promise<HouseholdView>;
  approvals(actor: Actor, input: HouseholdIdInput): Promise<PayerApprovalView[]>;
  approve(actor: Actor, input: ApprovalIdInput): Promise<PayerApprovalView>;
  decline(actor: Actor, input: ApprovalIdInput): Promise<PayerApprovalView>;
}
