import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import { CallSession } from '../chat-io.js';
import {
  AnnounceInput,
  BoardingPass,
  BoardInput,
  BookingIdInput,
  RateBookingInput,
  BookingView,
  BookSeatInput,
  CancelDepartureInput,
  CheckInInput,
  DemandBoardInput,
  DemandBucket,
  DemandPostIdInput,
  DemandPostView,
  DepartureBookingInput,
  DepartureIdInput,
  DepartureRiderName,
  DriverCardsInput,
  DriverDepartureView,
  DriverPositionInput,
  DriverRequestRide,
  GarageOpsInput,
  GarageOpsView,
  HoldSeatInput,
  ImHereInput,
  ImHereOutput,
  IntercityBoard,
  IntercityNetwork,
  MarkWalkUpInput,
  PickOfferInput,
  PinAlertCallInput,
  PinAlertsInput,
  PinAlertView,
  PinAttemptsInput,
  PinAttemptView,
  PostDemandInput,
  PostRequestInput,
  RequestIdInput,
  RequestListInput,
  RequestOfferInput,
  UsualRange,
  UsualRangeInput,
  RequestPositionInput,
  RequestPostView,
  RajaaDriverCard,
  RajaaDriverProfile,
  RajaaDriverProfileInput,
  ReviewsOpsInput,
  REVIEW_MODERATION_ROLES,
  ReviewOpsView,
  HideReviewInput,
  UnhideReviewInput,
  RespondPickupInput,
  SelfieInput,
} from '../routes-io.js';
import { SafetyCallSession } from '../safety-io.js';
import { OverdueDeparture, OverdueDeparturesInput, StaffDepartureInput, StaffDepartureResult } from '../departure-staff-io.js';
import { protectedProcedure, router } from '../trpc.js';

/** Drivers who announce departures and offer on the request board. */
export const INTERCITY_DRIVER_ROLES: readonly RoleKind[] = ['intercity_driver'];
/** Ops roles that watch garages and act on any departure. */
export const INTERCITY_OPS_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'admin'];

/**
 * الرجعة (customer spec §2): garages, departures, seats, the demand board and the request board.
 * Riders: any signed-in person (as `orders.place`). Drivers: `intercity_driver`. Ops: Console roles.
 * Everything goes through `ctx.routes`, the API's port (`modules/routes`).
 */
export const routesRouter = router({
  /** Garages, corridors (with seat prices) and on-the-way meeting points. */
  network: protectedProcedure()
    .output(IntercityNetwork)
    .query(({ ctx }) => ctx.routes.network()),
  /** The driver of each departure (first name, today's selfie check-in, photo): board, seat sheet, boarding pass (C-19). */
  driverCards: protectedProcedure()
    .input(DriverCardsInput)
    .output(z.array(RajaaDriverCard))
    .query(({ ctx, input }) => ctx.routes.driverCards(ctx.actor, input)),
  /** «ملفه» (x12–x17): the driver's record, quality bars, badges and reviews; same visibility as driverCards. */
  driverProfile: protectedProcedure()
    .input(RajaaDriverProfileInput)
    .output(RajaaDriverProfile)
    .query(({ ctx, input }) => ctx.routes.driverProfile(ctx.actor, input)),
  /** Live departure board per garage (or corridor + direction), with fill and front-seat status. */
  board: protectedProcedure()
    .input(BoardInput)
    .output(IntercityBoard)
    .query(({ ctx, input }) => ctx.routes.board(ctx.actor, input)),

  // ── riders ──
  /** Hold seat(s) / a row / the car for 10 minutes, free. */
  holdSeat: protectedProcedure()
    .input(HoldSeatInput)
    .output(BookingView)
    .mutation(({ ctx, input }) => ctx.routes.holdSeat(ctx.actor, input)),
  /** Own the hold: prepay from the wallet, or a cash reservation. */
  bookSeat: protectedProcedure()
    .input(BookSeatInput)
    .output(BookingView)
    .mutation(({ ctx, input }) => ctx.routes.bookSeat(ctx.actor, input)),
  cancelSeat: protectedProcedure()
    .input(BookingIdInput)
    .output(BookingView)
    .mutation(({ ctx, input }) => ctx.routes.cancelSeat(ctx.actor, input)),
  myBookings: protectedProcedure()
    .output(z.array(BookingView))
    .query(({ ctx }) => ctx.routes.myBookings(ctx.actor)),
  /** «شلون كانت الرجعة؟» (joy r2): stars and chips, once, on the rider's own completed booking. */
  rateBooking: protectedProcedure()
    .input(RateBookingInput)
    .output(BookingView)
    .mutation(({ ctx, input }) => ctx.routes.rateBooking(ctx.actor, input)),
  boardingPass: protectedProcedure()
    .input(BookingIdInput)
    .output(BoardingPass)
    .query(({ ctx, input }) => ctx.routes.boardingPass(ctx.actor, input)),
  /** "أني بالكراج" / at the meeting point: blocks a no-show inside the geofence, warns on a mismatch. */
  imHere: protectedProcedure()
    .input(ImHereInput)
    .output(ImHereOutput)
    .mutation(({ ctx, input }) => ctx.routes.imHere(ctx.actor, input)),
  /** "أريد أرجع": a demand post that expires at the end of its window. */
  postDemand: protectedProcedure()
    .input(PostDemandInput)
    .output(DemandPostView)
    .mutation(({ ctx, input }) => ctx.routes.postDemand(ctx.actor, input)),
  myDemand: protectedProcedure()
    .output(z.array(DemandPostView))
    .query(({ ctx }) => ctx.routes.myDemand(ctx.actor)),
  cancelDemand: protectedProcedure()
    .input(DemandPostIdInput)
    .output(DemandPostView)
    .mutation(({ ctx, input }) => ctx.routes.cancelDemand(ctx.actor, input)),
  requestBoard: router({
    /** Rider: post a trip to another destination or a private car. */
    post: protectedProcedure()
      .input(PostRequestInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.postRequest(ctx.actor, input)),
    /** Rider, on the form (p1): what this trip usually costs; null until 5 finished trips in 90 days. */
    usualRange: protectedProcedure()
      .input(UsualRangeInput)
      .output(UsualRange.nullable())
      .query(({ ctx, input }) => ctx.routes.usualRange(ctx.actor, input)),
    /** Rider: own posts with their offers. */
    mine: protectedProcedure()
      .output(z.array(RequestPostView))
      .query(({ ctx }) => ctx.routes.myRequests(ctx.actor)),
    /** Driver: open posts to offer on. */
    list: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestListInput)
      .output(z.array(RequestPostView))
      .query(({ ctx, input }) => ctx.routes.openRequests(ctx.actor, input)),
    /** Driver: he opened the request (y4); the rider sees how many drivers did. Idempotent. */
    seen: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.requestSeen(ctx.actor, input)),
    /** Driver: offer a price (multiples of 1,000); a new offer replaces the driver's previous one. */
    offer: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestOfferInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.offerOnRequest(ctx.actor, input)),
    /** Rider: pick an offer; 20 % deposit (min 5,000) held on the wallet. */
    pick: protectedProcedure()
      .input(PickOfferInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.pickOffer(ctx.actor, input)),
    cancel: protectedProcedure()
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.cancelRequest(ctx.actor, input)),
    /** Driver at the pickup (GPS recorded). */
    arrived: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestPositionInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.requestArrived(ctx.actor, input)),
    /** w2: the driver dropped the rider on a «يستناك وترجع» trip; the waiting clock starts. */
    waitStart: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.requestWaitStart(ctx.actor, input)),
    /** w2: the rider is back in the car; the clock stops. */
    waitEnd: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.requestWaitEnd(ctx.actor, input)),
    /**
     * k2: the picked driver calls the person he is fetching on a «جيب واحد» trip, or the poster on any
     * other kind, through the masked-call bridge; never a raw number in production.
     */
    callPerson: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestIdInput)
      .output(CallSession)
      .mutation(({ ctx, input }) => ctx.routes.requestCall(ctx.actor, input)),
    complete: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.requestCompleted(ctx.actor, input)),
    /** Driver: the rider did not come — the deposit goes to the driver. */
    riderNoShow: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.reportRiderNoShow(ctx.actor, input)),
    /** Driver: rides where the rider picked his offer (live ones, and those closed in the last 12 h). */
    myRides: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .output(z.array(DriverRequestRide))
      .query(({ ctx }) => ctx.routes.myRequestRides(ctx.actor)),
    /** Rider: the driver did not come — 2× the deposit from the driver's balance. */
    driverNoShow: protectedProcedure()
      .input(RequestIdInput)
      .output(RequestPostView)
      .mutation(({ ctx, input }) => ctx.routes.reportDriverNoShow(ctx.actor, input)),
  }),

  // ── intercity drivers ──
  driver: router({
    announce: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(AnnounceInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.announce(ctx.actor, input)),
    mine: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .output(z.array(DriverDepartureView))
      .query(({ ctx }) => ctx.routes.myDepartures(ctx.actor)),
    departure: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DepartureIdInput)
      .output(DriverDepartureView)
      .query(({ ctx, input }) => ctx.routes.driverDeparture(ctx.actor, input)),
    /** First names of the riders on his own departure (vault reads logged, purpose intercity_manifest). */
    riders: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DepartureIdInput)
      .output(z.array(DepartureRiderName))
      .query(({ ctx, input }) => ctx.routes.driverRiders(ctx.actor, input)),
    /** Demand counts per garage and window (claimed vs posted). */
    demand: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DemandBoardInput)
      .output(z.array(DemandBucket))
      .query(({ ctx, input }) => ctx.routes.demandBoard(ctx.actor, input)),
    /** Per-run check-in selfie: walk-ups count toward fill only after it. */
    selfie: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(SelfieInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.selfie(ctx.actor, input)),
    /** Position fix: the first fix inside the 150 m garage geofence checks the driver in; trail feeds the checkpoint waiver and the riders' live car. */
    position: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DriverPositionInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.driverPosition(ctx.actor, input)),
    markWalkUp: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(MarkWalkUpInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.markWalkUp(ctx.actor, input)),
    /** Rider's 4-digit PIN. */
    checkIn: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(CheckInInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.checkIn(ctx.actor, input)),
    /** Masked call to one of his riders (garage mode: a late rider's "اتصل"); never a raw number in production. */
    callRider: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DepartureBookingInput)
      .output(CallSession)
      .mutation(({ ctx, input }) => ctx.routes.callRider(ctx.actor, input)),
    markNoShow: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DepartureBookingInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.markNoShow(ctx.actor, input)),
    /** Accept or decline a door pickup (max 2, ≤ 15 min detour). */
    respondPickup: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RespondPickupInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.respondPickup(ctx.actor, input)),
    depart: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DepartureIdInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.depart(ctx.actor, input)),
    arrive: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(DepartureIdInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.arrive(ctx.actor, input)),
    cancel: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(CancelDepartureInput)
      .output(DriverDepartureView)
      .mutation(({ ctx, input }) => ctx.routes.cancelDeparture(ctx.actor, input)),
  }),

  // ── ops ──
  ops: router({
    /** Console garage view: departures with riders, demand, open requests, stranded riders. */
    garage: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(GarageOpsInput)
      .output(GarageOpsView)
      .query(({ ctx, input }) => ctx.routes.garageView(ctx.actor, input)),
    /**
     * Seat-PIN alerts for the Console safety strip (Ali 2026-10-06): a rider's PIN typed on another
     * rider's seat, or `PIN_ATTEMPT_RULES.wrongOnSeatAlertAt` refused PINs on one seat, each with the
     * car's PIN history. Polled like the SOS banner.
     */
    pinAlerts: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(PinAlertsInput)
      .output(z.array(PinAlertView))
      .query(({ ctx, input }) => ctx.routes.pinAlerts(ctx.actor, input)),
    /** Every PIN typed on one departure and what it did (ids and seats only). */
    pinAttempts: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(PinAttemptsInput)
      .output(z.array(PinAttemptView))
      .query(({ ctx, input }) => ctx.routes.pinAttempts(ctx.actor, input)),
    /** Masked call to the driver of a PIN alert (logged on the departure, never a number). */
    callPinAlertDriver: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(PinAlertCallInput)
      .output(SafetyCallSession)
      .mutation(({ ctx, input }) => ctx.routes.callPinAlertDriver(ctx.actor, input)),
    /** «كلام الركاب»: riders' written reviews, newest first, shown and hidden. */
    reviews: protectedProcedure(REVIEW_MODERATION_ROLES)
      .input(ReviewsOpsInput)
      .output(z.array(ReviewOpsView))
      .query(({ ctx, input }) => ctx.routes.reviews(ctx.actor, input)),
    /** Take a review off the driver's profile (kept and logged; `unhideReview` puts it back). */
    hideReview: protectedProcedure(REVIEW_MODERATION_ROLES)
      .input(HideReviewInput)
      .output(ReviewOpsView)
      .mutation(({ ctx, input }) => ctx.routes.hideReview(ctx.actor, input)),
    unhideReview: protectedProcedure(REVIEW_MODERATION_ROLES)
      .input(UnhideReviewInput)
      .output(ReviewOpsView)
      .mutation(({ ctx, input }) => ctx.routes.unhideReview(ctx.actor, input)),
    /**
     * W3 / NTF-14: departures that need a person — the driver never came (past the latest departure
     * time) or never pressed «وصلت» (past the expected arrival). Polled by the Console garage view.
     */
    overdueDepartures: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(OverdueDeparturesInput)
      .output(z.array(OverdueDeparture))
      .query(({ ctx, input }) => ctx.routes.overdueDepartures(ctx.actor, input)),
    /** Cancel for a driver who never came: riders moved to the next cars, no fee (M-11 open), audit row. */
    cancelDeparture: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(StaffDepartureInput)
      .output(StaffDepartureResult)
      .mutation(({ ctx, input }) => ctx.routes.opsCancelDeparture(ctx.actor, input)),
    /** «وصلت» on the driver's behalf: checked-in seats complete and settle as on his own tap; audit row. */
    arriveDeparture: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(StaffDepartureInput)
      .output(StaffDepartureResult)
      .mutation(({ ctx, input }) => ctx.routes.opsArriveDeparture(ctx.actor, input)),
    /** Close an arrived departure now (the scheduler would after `closeAfterArrivalMin`); audit row. */
    closeDeparture: protectedProcedure(INTERCITY_OPS_ROLES)
      .input(StaffDepartureInput)
      .output(StaffDepartureResult)
      .mutation(({ ctx, input }) => ctx.routes.opsCloseDeparture(ctx.actor, input)),
  }),
});
