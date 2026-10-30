import { z } from 'zod';
import type { RoleKind } from './auth.js';
import type { Actor } from './identity-io.js';

/**
 * p4 (Ali 2026-10-08): a dish photo the shop uploads itself shows to customers at once, and Driver's
 * team looks at it the same day. Console › الموافقات lists the photos still waiting (oldest first),
 * and staff keep each one («تمام») or take a bad one down («انزّلها», with a reason the shop sees).
 * The catalog side — the pending stamp, the queue, clearing it — is the catalog module's
 * (`docs/api/merchant-shop-rules.md` § p4).
 */

/** Who looks at shop photos: support, field ops (they know the shops) and admins. */
export const DISH_PHOTO_REVIEW_ROLES: readonly RoleKind[] = ['support', 'field_ops', 'admin'];

export const DISH_PHOTO_RULES = {
  /** Photos the queue shows at most (oldest first). */
  queueLimit: 200,
  /** A photo waiting longer than this is late for the same-day look (the row turns warm). */
  lateAfterHours: 8,
} as const;

export const DishPhotoQueueInput = z.object({ cityId: z.string().min(1) });
export type DishPhotoQueueInput = z.infer<typeof DishPhotoQueueInput>;

export const DishPhotoRow = z.object({
  itemId: z.string(),
  merchantOrgId: z.string(),
  storeName: z.string(),
  dishName: z.string(),
  priceIqd: z.number().int(),
  /** A signed read link (it expires); null when the photo cannot be shown here. */
  photoUrl: z.string().nullable(),
  /** When the shop put the photo up: also the version staff saw, sent back with «تمام». */
  pendingSince: z.coerce.date(),
});
export type DishPhotoRow = z.infer<typeof DishPhotoRow>;

export const KeepDishPhotoInput = z.object({
  merchantOrgId: z.string().min(1),
  itemId: z.string().min(1),
  /** The `pendingSince` of the row staff looked at: a newer upload since then is not kept unseen. */
  pendingSince: z.coerce.date(),
});
export type KeepDishPhotoInput = z.infer<typeof KeepDishPhotoInput>;

/** `kept`: this look cleared it. `changed`: the shop put up another photo since. `gone`: someone already looked, or the dish is gone. */
export const KeepDishPhotoResult = z.object({ itemId: z.string(), outcome: z.enum(['kept', 'changed', 'gone']) });
export type KeepDishPhotoResult = z.infer<typeof KeepDishPhotoResult>;

/** Why a photo came down; the Merchant app tells the owner (`catalog.photo_taken_down`). */
export const DISH_PHOTO_TAKEDOWN_REASONS = ['blurry', 'wrong_dish', 'people', 'other'] as const;
export const DishPhotoTakedownReason = z.enum(DISH_PHOTO_TAKEDOWN_REASONS);
export type DishPhotoTakedownReason = z.infer<typeof DishPhotoTakedownReason>;

export const TakeDownDishPhotoInput = KeepDishPhotoInput.extend({ reason: DishPhotoTakedownReason });
export type TakeDownDishPhotoInput = z.infer<typeof TakeDownDishPhotoInput>;

/** `taken_down`: the dish shows no photo until the shop puts up another. `changed` / `gone`: as for «تمام», nothing written. */
export const TakeDownDishPhotoResult = z.object({ itemId: z.string(), outcome: z.enum(['taken_down', 'changed', 'gone']) });
export type TakeDownDishPhotoResult = z.infer<typeof TakeDownDishPhotoResult>;

/** What the API supplies to `ops.dishPhotos.*` (implemented in `modules/ops` over the catalog module). */
export interface DishPhotoReviewPort {
  queue(actor: Actor, input: DishPhotoQueueInput): Promise<DishPhotoRow[]>;
  /** Audited (`console_audit_log`, action `store.dish_photo_kept`). */
  keep(actor: Actor, input: KeepDishPhotoInput): Promise<KeepDishPhotoResult>;
  /** Audited (`store.dish_photo_taken_down`) and recorded as `catalog.photo_taken_down` on the store. */
  takeDown(actor: Actor, input: TakeDownDishPhotoInput): Promise<TakeDownDishPhotoResult>;
}
