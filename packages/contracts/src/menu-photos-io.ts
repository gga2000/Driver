import { z } from 'zod';
import type { RoleKind } from './auth.js';
import { LatLng } from './common.js';
import type { Actor } from './identity-io.js';
import { MerchantScope } from './merchant-admin-io.js';

/**
 * Menu photo service (maps program k3, spec §5.7): a restaurant asks for its dishes to be
 * photographed; field ops set a visit, shoot each dish through the Partner app, and the owner accepts
 * or rejects every photo in the Merchant app. Only an accepted photo reaches the menu (the same
 * catalog photo the owner's own edit sets), because the photographer is not the merchant and a
 * customer's menu should only change with the owner's yes. The shoot is free (no fee exists).
 */

export const MENU_PHOTO_RULES = {
  /** Dishes one request can name; none named = the whole menu. */
  maxItems: 80,
  /** «الأفضل الصبح قبل الزحمة» fits easily. */
  noteMaxChars: 200,
  /** How far ahead field ops can set a visit. */
  maxScheduleAheadDays: 14,
  /** A visit set a little in the past is fine (he set it on arrival); older is a slip of the finger. */
  scheduleGraceMin: 60,
  /** Requests a store sees in its history (the open one plus the latest closed ones). */
  historyLimit: 10,
  /** Requests the Console queue shows at most. */
  queueLimit: 200,
} as const;

/** Who sees the Console queue (the zones readers: ops, support, finance, admin, field ops). */
export const MENU_PHOTO_QUEUE_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin', 'field_ops'];

/**
 * requested (the merchant asked) → scheduled (a field ops person took it and set a visit) → shot
 * (photos handed over to the merchant) → done (every photo accepted or rejected) | cancelled (the
 * merchant called it off before the shoot).
 */
export const MenuPhotoRequestState = z.enum(['requested', 'scheduled', 'shot', 'done', 'cancelled']);
export type MenuPhotoRequestState = z.infer<typeof MenuPhotoRequestState>;
/** The states a store can have only one of at a time. */
export const OPEN_MENU_PHOTO_STATES: readonly MenuPhotoRequestState[] = ['requested', 'scheduled', 'shot'];

export const MenuShotState = z.enum(['proposed', 'accepted', 'rejected']);
export type MenuShotState = z.infer<typeof MenuShotState>;

/** One photo of one dish from the visit. */
export const MenuShotView = z.object({
  shotId: z.string(),
  itemId: z.string(),
  /** Signed read link (expires; the apps refetch). */
  photoUrl: z.string(),
  state: MenuShotState,
  takenAt: z.coerce.date(),
});
export type MenuShotView = z.infer<typeof MenuShotView>;

/** A dish to shoot, with its photo today and the visit's photo once taken. */
export const MenuPhotoDish = z.object({
  itemId: z.string(),
  nameAr: z.string(),
  categoryAr: z.string().nullable(),
  /** The photo customers see today (signed), if any. */
  currentPhotoUrl: z.string().nullable(),
  shot: MenuShotView.nullable(),
});
export type MenuPhotoDish = z.infer<typeof MenuPhotoDish>;

export const MenuPhotoRequestView = z.object({
  requestId: z.string(),
  merchantOrgId: z.string(),
  storeName: z.string(),
  cityId: z.string(),
  /** Where the store is, for the visit (zone key and pin when on file). */
  zoneKey: z.string().nullable(),
  pin: LatLng.nullable(),
  state: MenuPhotoRequestState,
  note: z.string().nullable(),
  /** No dishes were named: every dish on the menu. */
  wholeMenu: z.boolean(),
  dishes: z.array(MenuPhotoDish),
  /** The field ops person who took it (first name only), once scheduled. */
  photographerName: z.string().nullable(),
  /** The caller is that person (Partner: his own visits first). */
  assignedToMe: z.boolean(),
  scheduledFor: z.coerce.date().nullable(),
  requestedAt: z.coerce.date(),
  shotAt: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  counts: z.object({
    dishes: z.number().int(),
    proposed: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
  }),
  /**
   * The caller may act on it now: in the Merchant app the owner (staff read only); in the Partner app
   * the field ops person who has it, or anyone while nobody has it yet.
   */
  canAct: z.boolean(),
});
export type MenuPhotoRequestView = z.infer<typeof MenuPhotoRequestView>;

// ───────────────────────── merchant ─────────────────────────

export const RequestMenuPhotosInput = MerchantScope.extend({
  /** The dishes to shoot; empty = the whole menu. */
  itemIds: z.array(z.string().min(1)).max(MENU_PHOTO_RULES.maxItems).default([]),
  note: z.string().trim().max(MENU_PHOTO_RULES.noteMaxChars).optional(),
});
export type RequestMenuPhotosInput = z.input<typeof RequestMenuPhotosInput>;

export const MenuPhotoRequestRef = MerchantScope.extend({ requestId: z.string().min(1) });
export type MenuPhotoRequestRef = z.infer<typeof MenuPhotoRequestRef>;

export const DecideMenuShotInput = MenuPhotoRequestRef.extend({ shotId: z.string().min(1), accept: z.boolean() });
export type DecideMenuShotInput = z.infer<typeof DecideMenuShotInput>;

// ───────────────────────── field ops ─────────────────────────

export const OpenMenuPhotoRequestsInput = z.object({ cityId: z.string().min(1).default('aziziyah') });
export const OpsMenuPhotoRef = z.object({ requestId: z.string().min(1) });
export const ScheduleMenuPhotosInput = OpsMenuPhotoRef.extend({ scheduledFor: z.coerce.date() });
export type ScheduleMenuPhotosInput = z.infer<typeof ScheduleMenuPhotosInput>;
export const AddMenuShotInput = OpsMenuPhotoRef.extend({
  itemId: z.string().min(1),
  /** From `places.photoUpload` (signed PUT), uploaded by the caller himself. */
  uploadId: z.string().min(1),
});
export type AddMenuShotInput = z.infer<typeof AddMenuShotInput>;

// ───────────────────────── Console ─────────────────────────

export const MenuPhotoQueueInput = z.object({ cityId: z.string().min(1).default('aziziyah'), state: MenuPhotoRequestState.optional() });

export interface MenuPhotosPort {
  /** The store's requests: open first, then the latest closed ones (owner and staff). */
  merchantList(actor: Actor, input: MerchantScope): Promise<MenuPhotoRequestView[]>;
  /** Owner: ask for a shoot (one open request per store). */
  request(actor: Actor, input: z.output<typeof RequestMenuPhotosInput>): Promise<MenuPhotoRequestView>;
  /** Owner: call it off before the photos are handed over. */
  cancel(actor: Actor, input: MenuPhotoRequestRef): Promise<MenuPhotoRequestView>;
  /** Owner: accept (it becomes the dish's photo) or reject one photo. */
  decide(actor: Actor, input: DecideMenuShotInput): Promise<MenuPhotoRequestView>;
  /** Field ops: requests waiting for a visit or being shot, in the city. */
  openForOps(actor: Actor, input: z.output<typeof OpenMenuPhotoRequestsInput>): Promise<MenuPhotoRequestView[]>;
  opsGet(actor: Actor, input: z.infer<typeof OpsMenuPhotoRef>): Promise<MenuPhotoRequestView>;
  /** Field ops: take the request and set (or move) the visit. */
  schedule(actor: Actor, input: ScheduleMenuPhotosInput): Promise<MenuPhotoRequestView>;
  /** Field ops: the photo of one dish (a second one replaces the first until handed over). */
  addShot(actor: Actor, input: AddMenuShotInput): Promise<MenuPhotoRequestView>;
  /** Field ops: hand the photos over to the merchant («صور المنيو جاهزة»). */
  markShot(actor: Actor, input: z.infer<typeof OpsMenuPhotoRef>): Promise<MenuPhotoRequestView>;
  /** Console: every request in the city, open first, oldest first. */
  queue(actor: Actor, input: z.output<typeof MenuPhotoQueueInput>): Promise<MenuPhotoRequestView[]>;
}
