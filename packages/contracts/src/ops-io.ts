import { z } from 'zod';
import { DeliveryPoint, Iqd, LatLng } from './common.js';
import { CapTier, SettlementMode } from './ledger-rules.js';
import type { Actor } from './identity-io.js';

/**
 * `ops.*` — Ops mode for field staff (`field_ops`; partner spec): landmark photos, cash receipts from
 * couriers, merchant onboarding visits and the day's task list. Money moves only through the
 * ledger's public API; contacts' phones and names go to the identity vault.
 */

export const LandmarkTarget = z.object({ kind: z.enum(['place', 'meeting_point', 'landmark']), id: z.string().min(1) });
export type LandmarkTarget = z.infer<typeof LandmarkTarget>;

export const AddLandmarkPhotoInput = z.object({
  target: LandmarkTarget,
  /** From `places.photoUpload` (signed PUT). */
  uploadId: z.string().min(1),
  caption: z.string().trim().max(120).optional(),
  /** Local names drivers use ("يم الجامع الكبير"), proposed with the photo. */
  localNames: z.array(z.string().trim().min(1).max(60)).max(5).default([]),
});
export type AddLandmarkPhotoInput = z.input<typeof AddLandmarkPhotoInput>;

export const LandmarkPhotoView = z.object({
  photoId: z.string(),
  target: LandmarkTarget,
  /** Console approves (domain §7: couriers and ops propose, console approves). */
  state: z.enum(['proposed', 'approved', 'rejected']),
  addedAt: z.coerce.date(),
});
export type LandmarkPhotoView = z.infer<typeof LandmarkPhotoView>;

/**
 * Courier → field ops cash hand-over (money §4 channel 1, "field-ops cash round with WhatsApp
 * receipt"). `code` is the courier's daily hand-over code (`driverAccount.handoverCode`), read out to
 * the ops person: both sides confirm.
 */
export const RecordCashReceiptInput = z.object({
  courierId: z.string().min(1),
  amountIqd: Iqd.positive(),
  code: z.string().regex(/^\d{4}$/),
  note: z.string().trim().max(200).optional(),
  /** Client retry key: a replay returns the first receipt. */
  idempotencyKey: z.string().min(8).max(128).optional(),
});
export type RecordCashReceiptInput = z.infer<typeof RecordCashReceiptInput>;

export const CashReceiptView = z.object({
  receiptId: z.string(),
  courierId: z.string(),
  amountIqd: Iqd,
  /** G-82 settlement reference printed on the WhatsApp receipt. */
  reference: z.string(),
  receivedAt: z.coerce.date(),
  /** The courier's position after the hand-over. */
  courierOwedIqd: Iqd,
  courierCapRemainingIqd: Iqd,
});
export type CashReceiptView = z.infer<typeof CashReceiptView>;

export const MerchantOnboardingInput = z.object({
  cityId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  type: z.enum(['restaurant', 'grocer']),
  /** The owner: phone and name go to the identity vault; the draft keeps only the person id. */
  contact: z.object({ name: z.string().trim().min(1).max(60), phone: z.string().min(7).max(20) }),
  location: DeliveryPoint,
  /** Menu photography from the same visit (scoring §2), via `places.photoUpload`. */
  menuPhotoUploadIds: z.array(z.string().min(1)).max(30).default([]),
  shopPhotoUploadId: z.string().min(1).optional(),
  notes: z.string().trim().max(500).optional(),
  /** How the merchant wants his cash back (decisions §3); the city default when absent. */
  settlementMode: SettlementMode.optional(),
});
export type MerchantOnboardingInput = z.input<typeof MerchantOnboardingInput>;

export const MerchantOnboardingView = z.object({
  onboardingId: z.string(),
  merchantOrgId: z.string(),
  state: z.enum(['draft', 'submitted', 'active', 'rejected']),
  menuPhotos: z.number().int(),
  /** The follow-up task (menu entry / owner ID check) created with the draft. */
  taskId: z.string(),
  createdAt: z.coerce.date(),
});
export type MerchantOnboardingView = z.infer<typeof MerchantOnboardingView>;

export const OpsTaskKind = z.enum(['cash_collection', 'merchant_followup', 'landmark_photo', 'document_check']);
export type OpsTaskKind = z.infer<typeof OpsTaskKind>;

export const OpsTask = z.object({
  /** Stored tasks have ids; computed ones (cash to collect now) are `cash:<driverId>`. */
  taskId: z.string(),
  kind: OpsTaskKind,
  title_ar: z.string(),
  refId: z.string().nullable(),
  amountIqd: Iqd.nullable(),
  dueAt: z.coerce.date().nullable(),
  state: z.enum(['open', 'done']),
  /** Stored tasks can be completed with `ops.completeTask`; computed ones clear themselves. */
  computed: z.boolean(),
});
export type OpsTask = z.infer<typeof OpsTask>;

export const MyTasksInput = z.object({ cityId: z.string().min(1).optional() });
export const CompleteTaskInput = z.object({ taskId: z.string().min(1), note: z.string().trim().max(200).optional() });

/** A courier holding customers' cash: who the ops person can take a hand-over from. */
export const OpsCashHolder = z.object({
  courierId: z.string(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  /** Cash in his hand that is not his. */
  heldIqd: Iqd,
  /** What counts against his cap (held + fees owed − earnings). */
  owedIqd: Iqd,
  capIqd: Iqd,
  tier: CapTier,
  overCap: z.boolean(),
});
export type OpsCashHolder = z.infer<typeof OpsCashHolder>;
export const CashHoldersInput = z.object({ cityId: z.string().min(1).optional() });

/** A landmark place field ops can photograph (shared city knowledge, `places.landmark`). */
export const OpsLandmark = z.object({
  placeId: z.string(),
  name: z.string(),
  zoneKey: z.string().nullable(),
  pin: LatLng,
  /** Photos on the place (approved) plus photos proposed through ops and not yet reviewed. */
  photos: z.number().int(),
});
export type OpsLandmark = z.infer<typeof OpsLandmark>;
export const LandmarksInput = z.object({ cityId: z.string().min(1).default('aziziyah'), zoneKey: z.string().min(1).optional() });

export interface OpsPort {
  cashHolders(actor: Actor, input: z.infer<typeof CashHoldersInput>): Promise<OpsCashHolder[]>;
  landmarks(actor: Actor, input: z.output<typeof LandmarksInput>): Promise<OpsLandmark[]>;
  addLandmarkPhoto(actor: Actor, input: z.output<typeof AddLandmarkPhotoInput>): Promise<LandmarkPhotoView>;
  recordCashReceipt(actor: Actor, input: RecordCashReceiptInput): Promise<CashReceiptView>;
  merchantOnboarding(actor: Actor, input: z.output<typeof MerchantOnboardingInput>): Promise<MerchantOnboardingView>;
  myTasks(actor: Actor, input: z.infer<typeof MyTasksInput>): Promise<OpsTask[]>;
  completeTask(actor: Actor, input: z.infer<typeof CompleteTaskInput>): Promise<OpsTask>;
}
