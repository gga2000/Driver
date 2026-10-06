import { z } from 'zod';
import type { RoleKind } from '../auth.js';
import { CallSession } from '../chat-io.js';
import {
  AnnounceInput,
  BoardingPass,
  BoardInput,
  BookingIdInput,
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
  PostDemandInput,
  PostRequestInput,
  RequestIdInput,
  RequestListInput,
  RequestOfferInput,
  RequestPositionInput,
  RequestPostView,
  RajaaDriverCard,
  RespondPickupInput,
  SelfieInput,
} from '../routes-io.js';
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
    /** Rider: own posts with their offers. */
    mine: protectedProcedure()
      .output(z.array(RequestPostView))
      .query(({ ctx }) => ctx.routes.myRequests(ctx.actor)),
    /** Driver: open posts to offer on. */
    list: protectedProcedure(INTERCITY_DRIVER_ROLES)
      .input(RequestListInput)
      .output(z.array(RequestPostView))
      .query(({ ctx, input }) => ctx.routes.openRequests(ctx.actor, input)),
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
  }),
});
