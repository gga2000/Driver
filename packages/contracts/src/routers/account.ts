import { z } from 'zod';
import {
  ApprovalIdInput,
  ClaimPointsOutput,
  ConfirmPlaceInput,
  CreateHouseholdInput,
  HouseholdIdInput,
  HouseholdView,
  InviteMemberInput,
  MonthInput,
  MonthInsightsView,
  RiderLandmarksInput,
  LandmarkView,
  LandmarkNearView,
  LandmarksNearInput,
  PayerApprovalView,
  PhotoUploadInput,
  PhotoUploadTicket,
  PlaceIdInput,
  SavedPlaceView,
  SavePlaceInput,
  SetBudgetInput,
  SetLimitInput,
  TopupOptionsView,
  UpdatePlaceInput,
  WalletBalanceView,
  WalletTransactionsInput,
  WalletTransactionsView,
  ZoneForPinInput,
  ZoneForPinOutput,
} from '../account-io.js';
import { RequestTopUpInput, TopUpStatusInput, TopUpView } from '../topup-io.js';
import { protectedProcedure, router } from '../trpc.js';

const Ok = z.object({ ok: z.literal(true) });

/**
 * Saved places (domain §7). Any signed-in person, on his own places; places a household member
 * shared come back read-only. Couriers never read places here: the assigned courier sees the note
 * and photos on his trip only (accepted → completed + 1 h).
 */
export const placesRouter = router({
  mine: protectedProcedure()
    .output(z.array(SavedPlaceView))
    .query(({ ctx }) => ctx.places.mine(ctx.actor)),
  save: protectedProcedure()
    .input(SavePlaceInput)
    .output(SavedPlaceView)
    .mutation(({ ctx, input }) => ctx.places.save(ctx.actor, input)),
  update: protectedProcedure()
    .input(UpdatePlaceInput)
    .output(SavedPlaceView)
    .mutation(({ ctx, input }) => ctx.places.update(ctx.actor, input)),
  remove: protectedProcedure()
    .input(PlaceIdInput)
    .output(Ok)
    .mutation(({ ctx, input }) => ctx.places.remove(ctx.actor, input)),
  /** "موقعي هنا" */
  confirm: protectedProcedure()
    .input(ConfirmPlaceInput)
    .output(SavedPlaceView)
    .mutation(({ ctx, input }) => ctx.places.confirm(ctx.actor, input)),
  /** Preview of the zone a pin falls in (the pin picker shows it before saving). */
  zoneFor: protectedProcedure()
    .input(ZoneForPinInput)
    .output(ZoneForPinOutput)
    .query(({ ctx, input }) => ctx.places.zoneFor(input)),
  /** Landmarks to search ("وين رايح؟"): seeded garages and meeting points plus verified landmark places. */
  landmarks: protectedProcedure()
    .input(RiderLandmarksInput)
    .output(z.array(LandmarkView))
    .query(async ({ ctx, input }) => (ctx.places.landmarks ? ctx.places.landmarks(input) : [])),
  /** "قرب شنو؟" (maps a2): landmarks within 500 m of a pin being saved, nearest first, at most 5. */
  landmarksNear: protectedProcedure()
    .input(LandmarksNearInput)
    .output(z.array(LandmarkNearView))
    .query(({ ctx, input }) => ctx.places.landmarksNear(input)),
  /** Signed upload ticket for a gate/door photo. */
  photoUpload: protectedProcedure()
    .input(PhotoUploadInput)
    .output(PhotoUploadTicket)
    .mutation(({ ctx, input }) => ctx.places.photoUpload(ctx.actor, input)),
});

/** المحفظة (customer spec §9): the caller's own balance, points and lines. */
export const walletRouter = router({
  balance: protectedProcedure()
    .output(WalletBalanceView)
    .query(({ ctx }) => ctx.wallet.balance(ctx.actor)),
  transactions: protectedProcedure()
    .input(WalletTransactionsInput)
    .output(WalletTransactionsView)
    .query(({ ctx, input }) => ctx.wallet.transactions(ctx.actor, input)),
  topupOptions: protectedProcedure()
    .output(TopupOptionsView)
    .query(({ ctx }) => ctx.wallet.topupOptions(ctx.actor)),
  claimPoints: protectedProcedure()
    .output(ClaimPointsOutput)
    .mutation(({ ctx }) => ctx.wallet.claimPoints(ctx.actor)),
  /** «شهرك» (joy w6): the caller's month — meals, kitchens, rides, الرجعة, what was saved, points. Private. */
  month: protectedProcedure()
    .input(MonthInput)
    .output(MonthInsightsView)
    .query(({ ctx, input }) => ctx.insights.month(ctx.actor, input)),
  /** "شحن المحفظة": a 6-digit code (+ QR) to hand over with the cash to an ops agent or the next courier. */
  requestTopUp: protectedProcedure()
    .input(RequestTopUpInput)
    .output(TopUpView)
    .mutation(({ ctx, input }) => ctx.topups.request(ctx.actor, input)),
  /** A top-up request by id, else the caller's latest; the code screen polls it until confirmed. */
  topUpStatus: protectedProcedure()
    .input(TopUpStatusInput)
    .output(TopUpView.nullable())
    .query(({ ctx, input }) => ctx.topups.status(ctx.actor, input)),
});

/** Households (domain §12). Members read; payers invite, set limits and resolve approvals. */
export const householdRouter = router({
  mine: protectedProcedure()
    .output(HouseholdView.nullable())
    .query(({ ctx }) => ctx.households.mine(ctx.actor)),
  create: protectedProcedure()
    .input(CreateHouseholdInput)
    .output(HouseholdView)
    .mutation(({ ctx, input }) => ctx.households.create(ctx.actor, input)),
  inviteMember: protectedProcedure()
    .input(InviteMemberInput)
    .output(HouseholdView)
    .mutation(({ ctx, input }) => ctx.households.inviteMember(ctx.actor, input)),
  setLimit: protectedProcedure()
    .input(SetLimitInput)
    .output(HouseholdView)
    .mutation(({ ctx, input }) => ctx.households.setLimit(ctx.actor, input)),
  /** w4: a member's monthly budget on the household wallet (payer only). */
  setBudget: protectedProcedure()
    .input(SetBudgetInput)
    .output(HouseholdView)
    .mutation(({ ctx, input }) => ctx.households.setBudget(ctx.actor, input)),
  approvals: protectedProcedure()
    .input(HouseholdIdInput)
    .output(z.array(PayerApprovalView))
    .query(({ ctx, input }) => ctx.households.approvals(ctx.actor, input)),
  approve: protectedProcedure()
    .input(ApprovalIdInput)
    .output(PayerApprovalView)
    .mutation(({ ctx, input }) => ctx.households.approve(ctx.actor, input)),
  decline: protectedProcedure()
    .input(ApprovalIdInput)
    .output(PayerApprovalView)
    .mutation(({ ctx, input }) => ctx.households.decline(ctx.actor, input)),
});
