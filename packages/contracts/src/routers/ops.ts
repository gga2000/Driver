import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import {
  AddLandmarkPhotoInput,
  CashHoldersInput,
  CashReceiptView,
  CompleteTaskInput,
  LandmarkPhotoView,
  LandmarksInput,
  MerchantOnboardingInput,
  MerchantOnboardingView,
  MyTasksInput,
  OpsCashHolder,
  OpsLandmark,
  OpsTask,
  RecordCashReceiptInput,
} from '../ops-io.js';
import {
  AddMenuShotInput,
  MENU_PHOTO_QUEUE_ROLES,
  MenuPhotoQueueInput,
  MenuPhotoRequestView,
  OpenMenuPhotoRequestsInput,
  OpsMenuPhotoRef,
  ScheduleMenuPhotosInput,
} from '../menu-photos-io.js';
import { ConsolePickupSpotView, MerchantOrgInput, PICKUP_SPOT_CONSOLE_ROLES, PickupStoreRow, PickupStoresInput, SetPickupSpotInput } from '../merchant-io.js';
import { ConfirmTopUpInput, TopUpConfirmation, TopUpLookupInput, TopUpLookupView } from '../topup-io.js';
import { protectedProcedure, router } from '../trpc.js';
import { opsControlsRouter } from './control-room.js';
import { opsZonesRouter } from './zones.js';
import { opsWavesRouter } from './waves.js';

export const FIELD_OPS_ROLES: readonly RoleKind[] = ['field_ops', 'admin'];

/**
 * `ops.menuPhotos.*` — the menu photo service (maps k3): field ops take a restaurant's request, set
 * the visit, shoot each dish and hand the photos over; the Console reads the queue.
 */
export const opsMenuPhotosRouter = router({
  open: protectedProcedure(FIELD_OPS_ROLES)
    .input(OpenMenuPhotoRequestsInput)
    .output(z.array(MenuPhotoRequestView))
    .query(({ ctx, input }) => ctx.menuPhotos.openForOps(ctx.actor, input)),
  get: protectedProcedure(FIELD_OPS_ROLES)
    .input(OpsMenuPhotoRef)
    .output(MenuPhotoRequestView)
    .query(({ ctx, input }) => ctx.menuPhotos.opsGet(ctx.actor, input)),
  schedule: protectedProcedure(FIELD_OPS_ROLES)
    .input(ScheduleMenuPhotosInput)
    .output(MenuPhotoRequestView)
    .mutation(({ ctx, input }) => ctx.menuPhotos.schedule(ctx.actor, input)),
  addShot: protectedProcedure(FIELD_OPS_ROLES)
    .input(AddMenuShotInput)
    .output(MenuPhotoRequestView)
    .mutation(({ ctx, input }) => ctx.menuPhotos.addShot(ctx.actor, input)),
  markShot: protectedProcedure(FIELD_OPS_ROLES)
    .input(OpsMenuPhotoRef)
    .output(MenuPhotoRequestView)
    .mutation(({ ctx, input }) => ctx.menuPhotos.markShot(ctx.actor, input)),
  /** Console › الموافقات: every request in the city with its state (read only). */
  queue: protectedProcedure(MENU_PHOTO_QUEUE_ROLES)
    .input(MenuPhotoQueueInput)
    .output(z.array(MenuPhotoRequestView))
    .query(({ ctx, input }) => ctx.menuPhotos.queue(ctx.actor, input)),
});

/**
 * `ops.pickupSpots.*` — Console › المطاعم (Ali 2026-10-07): field ops and admins see every store's
 * pickup spot and set it for the owner (same rules as `merchant.setPickupSpot`, audited). Support
 * neither reads nor changes it.
 */
export const opsPickupSpotsRouter = router({
  stores: protectedProcedure(PICKUP_SPOT_CONSOLE_ROLES)
    .input(PickupStoresInput)
    .output(z.array(PickupStoreRow))
    .query(({ ctx, input }) => ctx.pickupSpots.stores(ctx.actor, input)),
  get: protectedProcedure(PICKUP_SPOT_CONSOLE_ROLES)
    .input(MerchantOrgInput)
    .output(ConsolePickupSpotView)
    .query(({ ctx, input }) => ctx.pickupSpots.get(ctx.actor, input)),
  set: protectedProcedure(PICKUP_SPOT_CONSOLE_ROLES)
    .input(SetPickupSpotInput)
    .output(ConsolePickupSpotView)
    .mutation(({ ctx, input }) => ctx.pickupSpots.set(ctx.actor, input)),
});

/** `ops.*` — Ops mode in the Partner app for field staff. */
export const opsRouter = router({
  addLandmarkPhoto: protectedProcedure(FIELD_OPS_ROLES)
    .input(AddLandmarkPhotoInput)
    .output(LandmarkPhotoView)
    .mutation(({ ctx, input }) => ctx.ops.addLandmarkPhoto(ctx.actor, input)),
  /** Courier → ops cash hand-over, confirmed by the courier's daily code; posts `driver_settlement`. */
  recordCashReceipt: protectedProcedure(FIELD_OPS_ROLES)
    .input(RecordCashReceiptInput)
    .output(CashReceiptView)
    .mutation(({ ctx, input }) => ctx.ops.recordCashReceipt(ctx.actor, input)),
  merchantOnboarding: protectedProcedure(FIELD_OPS_ROLES)
    .input(MerchantOnboardingInput)
    .output(MerchantOnboardingView)
    .mutation(({ ctx, input }) => ctx.ops.merchantOnboarding(ctx.actor, input)),
  myTasks: protectedProcedure(FIELD_OPS_ROLES)
    .input(MyTasksInput)
    .output(z.array(OpsTask))
    .query(({ ctx, input }) => ctx.ops.myTasks(ctx.actor, input)),
  /** Couriers holding customers' cash, most owed first (the cash-receipt courier picker). */
  cashHolders: protectedProcedure(FIELD_OPS_ROLES)
    .input(CashHoldersInput)
    .output(z.array(OpsCashHolder))
    .query(({ ctx, input }) => ctx.ops.cashHolders(ctx.actor, input)),
  /** Landmark places to photograph, optionally in one zone. */
  landmarks: protectedProcedure(FIELD_OPS_ROLES)
    .input(LandmarksInput)
    .output(z.array(OpsLandmark))
    .query(({ ctx, input }) => ctx.ops.landmarks(ctx.actor, input)),
  completeTask: protectedProcedure(FIELD_OPS_ROLES)
    .input(CompleteTaskInput)
    .output(OpsTask)
    .mutation(({ ctx, input }) => ctx.ops.completeTask(ctx.actor, input)),
  /** A customer's wallet top-up code: amount, state and who it is for, before taking the cash. */
  topUpLookup: protectedProcedure(FIELD_OPS_ROLES)
    .input(TopUpLookupInput)
    .output(TopUpLookupView)
    .query(({ ctx, input }) => ctx.topups.lookup(ctx.actor, input, 'ops_agent')),
  /** Cash counted: credits the customer's wallet once (single-use code, 24 h); the company holds the cash. */
  confirmTopUp: protectedProcedure(FIELD_OPS_ROLES)
    .input(ConfirmTopUpInput)
    .output(TopUpConfirmation)
    .mutation(({ ctx, input }) => ctx.topups.confirm(ctx.actor, input, 'ops_agent')),
  /** Launch control room: kill switches and the zone throttle (Console; admin / dispatcher to change). */
  controls: opsControlsRouter,
  /** Menu photo service (maps k3): field ops shoot dishes for restaurants. */
  menuPhotos: opsMenuPhotosRouter,
  /** Zone outlines drawn on a real map (Console › المناطق; admin / field ops to change). */
  zones: opsZonesRouter,
  /** Stores' pickup spots set from the Console (field ops, admin). */
  pickupSpots: opsPickupSpotsRouter,
  /** Customer waves (W5): open places per zone and the waitlist (admin / dispatcher to change). */
  waves: opsWavesRouter,
});
