import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type OverdueDeparture,
  type StaffDepartureDriver,
  type StaffDepartureResult,
  type CallSession,
  type BoardInput,
  type BoardingPass,
  type AgreementView,
  type BookingView,
  type DemandBucket,
  type DemandPostView,
  type DepartureRiderName,
  type DriverDepartureView,
  type DriverRequestRide,
  type GarageOpsView,
  type PinAlertView,
  type PinAttemptView,
  PIN_ATTEMPT_RULES,
  type SafetyCallSession,
  type ImHereOutput,
  type IntercityBoard,
  type IntercityNetwork,
  type RajaaDriverCard,
  type RajaaDriverProfile,
  type ReviewOpsView,
  type RequestOfferDriver,
  type RequestPostView,
  type RequestShareInvite,
  type UsualRange,
  type RoutesPort,
} from '@driver/contracts';
import { shortDisplayName } from '../identity/index.js';
import { agreementView } from './agreements.js';
import { AgreementsService } from './agreements.service.js';
import { DemandService } from './demand.service.js';
import { DeparturesService } from './departures.service.js';
import { DeparturesStaffService } from './departures.staff.js';
import { directionFrom } from './intercity.config.js';
import { riderMeterMinutes } from './late-meter.js';
import { LIVE, OPEN_DEPARTURE, sharedIqd, type BookingRecord, type DepartureRecord, type PinAttemptRecord, type RequestRecord } from './model.js';
import { RequestBoardService } from './request-board.service.js';
import { ROUTES_REPOSITORY, type DriverRecord, type RoutesRepository } from './routes.repository.js';
import { driverStats, firstTripAt, publicReviews, qualityBars } from './reputation.js';
import { MIN_MS } from './support.js';
import { ROUTES_CALLS, ROUTES_CONTROLS, ROUTES_RIDER_NAMES, type RiderNamesReader, type RoutesCallPort, type RoutesControlsPort, ROUTES_POINTS, type RoutesPointsReader } from './tokens.js';
import { HOME_CITY } from './intercity.config.js';
import {
  bookingView,
  corridorView,
  demandView,
  departureCard,
  driverDepartureView,
  garageView,
  graceEndsAt,
  pickupView,
  prepayRail,
  requestView as requestViewOf,
} from './views.js';

type In<K extends keyof RoutesPort> = Parameters<RoutesPort[K]>[1];

/** Asia/Baghdad is UTC+3 all year: "today" for a driver's check-in. */
function sameBaghdadDay(a: Date, b: Date): boolean {
  const day = (d: Date) => Math.floor((d.getTime() + 3 * 3600_000) / 86_400_000);
  return day(a) === day(b);
}

/**
 * `ctx.routes`: the routes router's port. Roles are checked by the router (riders: any signed-in
 * person; drivers: `intercity_driver`; ops: Console roles); ownership here — a rider acts on his
 * own bookings and posts, a driver on his own departures and picked offers.
 */
@Injectable()
export class RoutesRpc implements RoutesPort {
  constructor(
    private readonly departures: DeparturesService,
    private readonly demand: DemandService,
    private readonly requests: RequestBoardService,
    private readonly agreements: AgreementsService,
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Optional() @Inject(ROUTES_RIDER_NAMES) private readonly names: RiderNamesReader | null = null,
    @Optional() @Inject(ROUTES_CONTROLS) private readonly controls: RoutesControlsPort | null = null,
    @Optional() @Inject(ROUTES_CALLS) private readonly calls: RoutesCallPort | null = null,
    @Optional() @Inject(ROUTES_POINTS) private readonly points: RoutesPointsReader | null = null,
    @Optional() @Inject(DeparturesStaffService) private readonly staff: DeparturesStaffService | null = null,
  ) {}

  /** Seats booked (held seats that were booked, any later state but cancelled) since `since` — launch wall. */
  async seatsBookedSince(since: Date, to?: Date): Promise<number> {
    let seats = 0;
    for (const d of await this.repo.listDepartures({ from: new Date(since.getTime() - 86_400_000) })) {
      for (const b of await this.repo.bookingsFor(d.id)) {
        if (b.bookedAt && b.bookedAt.getTime() >= since.getTime() && (!to || b.bookedAt.getTime() < to.getTime()) && !['cancelled', 'cancelled_by_rider', 'expired'].includes(b.state)) seats += b.seatIds.length;
      }
    }
    return seats;
  }

  /**
   * The welcome screen's الرجعة facts (audit d-6, `catalog.today`): open cars still to leave today
   * (Baghdad day, both directions, not past their latest time) and the Aziziyah garage of the next
   * car to Baghdad — the first home garage when none is announced yet.
   */
  async today(): Promise<{ carsToday: number; baghdadGarage: { id: string; nameAr: string; nameEn: string } | null }> {
    const s = this.departures;
    const now = s.now();
    const BAGHDAD_OFFSET_MS = 3 * 3600_000;
    const DAY_MS = 86_400_000;
    const endOfDay = new Date(Math.floor((now.getTime() + BAGHDAD_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - BAGHDAD_OFFSET_MS);
    const deps = (
      await this.repo.listDepartures({ states: OPEN_DEPARTURE, from: new Date(now.getTime() - s.rules.maxLatestDepartureMin * MIN_MS), to: endOfDay })
    ).filter((d) => d.latestDepartureAt.getTime() > now.getTime());
    const toBaghdad = deps
      .filter((d) => d.direction === 'from_aziziyah' && s.corridor(d.corridorId).cityId === 'baghdad')
      .sort((a, b) => a.departAt.getTime() - b.departAt.getTime());
    const home = s.network.garages.filter((g) => g.cityId === HOME_CITY && !g.draft);
    const g = toBaghdad[0] ? s.garage(toBaghdad[0].garageId) : (home[0] ?? null);
    return { carsToday: deps.length, baghdadGarage: g ? { id: g.id, nameAr: g.nameAr, nameEn: g.nameEn } : null };
  }

  async network(): Promise<IntercityNetwork> {
    const n = this.departures.network;
    return { garages: n.garages.map(garageView), corridors: n.corridors.map(corridorView) };
  }

  async board(_actor: Actor, input: BoardInput): Promise<IntercityBoard> {
    const s = this.departures;
    const now = s.now();
    const from = input.from ?? new Date(now.getTime() - s.rules.maxLatestDepartureMin * MIN_MS);
    const to = input.to ?? new Date(now.getTime() + 12 * 3600_000);
    const garage = input.garageId ? s.garage(input.garageId) : null;
    let deps: DepartureRecord[];
    let demand: DemandBucket[] = [];
    if (garage) {
      deps = await this.repo.listDepartures({
        garageId: garage.id,
        states: OPEN_DEPARTURE,
        from,
        to,
      });
      if (input.corridorId) deps = deps.filter((d) => d.corridorId === input.corridorId);
      const corridors = input.corridorId
        ? [s.corridor(input.corridorId)]
        : s.network.corridors.filter(
            (c) => c.cityId === garage.cityId || garage.cityId === 'aziziyah',
          );
      for (const c of corridors)
        demand.push(
          ...(await this.demand.board({
            corridorId: c.id,
            direction: directionFrom(garage.cityId),
            from: now,
            to,
            garageId: garage.id,
          })),
        );
    } else {
      const corridor = s.corridor(input.corridorId!);
      deps = await this.repo.listDepartures({
        corridorId: corridor.id,
        direction: input.direction!,
        states: OPEN_DEPARTURE,
        from,
        to,
      });
      demand = await this.demand.board({
        corridorId: corridor.id,
        direction: input.direction!,
        from: now,
        to,
      });
    }
    // A run past its hard latest departure is not on the board any more.
    deps = deps.filter((d) => d.latestDepartureAt.getTime() > now.getTime());
    const cards = [];
    for (const d of deps)
      cards.push(departureCard(s, d, await this.repo.bookingsFor(d.id), input.travellingAs));
    return { garage: garage ? garageView(garage) : null, departures: cards, demand };
  }

  // ───────────────────────── riders ─────────────────────────

  async holdSeat(actor: Actor, input: In<'holdSeat'>): Promise<BookingView> {
    if (this.controls) {
      const dep = await this.repo.getDeparture(input.departureId);
      // Launch kill switch: a switched-off corridor (or الرجعة as a whole) takes no new holds.
      if (dep) await this.controls.assertCorridorOpen({ cityId: HOME_CITY, corridorId: dep.corridorId });
    }
    return this.view(await this.departures.hold(actor.personId, input), true);
  }

  async bookSeat(actor: Actor, input: In<'bookSeat'>): Promise<BookingView> {
    return this.view(
      await this.departures.book(actor.personId, input.bookingId, input.payment),
      true,
    );
  }

  async cancelSeat(actor: Actor, input: In<'cancelSeat'>): Promise<BookingView> {
    return this.view(await this.departures.cancel(actor.personId, input.bookingId), true);
  }

  async myBookings(actor: Actor): Promise<BookingView[]> {
    const out: BookingView[] = [];
    for (const b of await this.repo.bookingsOfRider(actor.personId))
      out.push(await this.view(b, true));
    return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async rateBooking(actor: Actor, input: In<'rateBooking'>): Promise<BookingView> {
    return this.view(await this.departures.rate(actor.personId, input.bookingId, { stars: input.stars, tags: input.tags, comment: input.comment }), true);
  }

  async boardingPass(actor: Actor, input: In<'boardingPass'>): Promise<BoardingPass> {
    const s = this.departures;
    const b = await s.booking(input.bookingId);
    if (b.riderId !== actor.personId) throw new DriverError('booking_not_found');
    if (b.state !== 'booked' && b.state !== 'checked_in')
      throw new DriverError('booking_state_conflict');
    const dep = await s.departure(b.departureId);
    const bookings = await this.repo.bookingsFor(dep.id);
    const now = s.now();
    // T−30, or earlier when the car is already boarding / left early because it filled up: the
    // rider on board must see the live car, not "the car shows 30 min before departure".
    const boardingOpen =
      now.getTime() >= dep.departAt.getTime() - s.rules.boardingWindowMin * MIN_MS ||
      dep.state === 'boarding' ||
      dep.state === 'departed' ||
      dep.state === 'arrived';
    // Review C-45: the car's position from the boarding window to arrival, never the stop list.
    const sharing =
      boardingOpen &&
      (dep.state === 'scheduled' || dep.state === 'boarding' || dep.state === 'departed');
    return {
      bookingId: b.id,
      departureId: dep.id,
      pin: b.pin,
      seatIds: b.seatIds,
      garage: garageView(s.garage(dep.garageId)),
      departAt: dep.departAt,
      latestDepartureAt: dep.latestDepartureAt,
      boardingOpen,
      prepayRail: prepayRail(b) ?? 'cash_reservation',
      car:
        sharing && dep.lastPosition
          ? { lat: dep.lastPosition.lat, lng: dep.lastPosition.lng, at: dep.lastPosition.at }
          : null,
      myStop: pickupView(b.pickup, s, dep),
      vehicle: { ...dep.vehicle, layout: dep.layout },
      driverId: dep.driverId,
      sharePath: `/share/intercity/${b.id}`,
      idReminder: true,
      graceEndsAt: graceEndsAt(s, dep, bookings, b),
      meterMinutes: b.state === 'booked' ? riderMeterMinutes(dep, bookings, b, now) : null,
    };
  }

  imHere(actor: Actor, input: In<'imHere'>): Promise<ImHereOutput> {
    return this.departures.imHere(actor.personId, input.bookingId, {
      lat: input.lat,
      lng: input.lng,
    });
  }

  async postDemand(actor: Actor, input: In<'postDemand'>): Promise<DemandPostView> {
    return demandView(await this.demand.post(actor.personId, input));
  }

  async myDemand(actor: Actor): Promise<DemandPostView[]> {
    return (await this.demand.mine(actor.personId)).map(demandView);
  }

  async cancelDemand(actor: Actor, input: In<'cancelDemand'>): Promise<DemandPostView> {
    return demandView(await this.demand.cancel(actor.personId, input.postId));
  }

  async postRequest(actor: Actor, input: In<'postRequest'>): Promise<RequestPostView> {
    // The request board has no corridor: only a switch on الرجعة as a whole stops it.
    await this.controls?.assertCorridorOpen({ cityId: HOME_CITY, corridorId: '*' });
    return this.riderRequestView(await this.requests.post(actor.personId, input), actor.personId);
  }

  /** A request as its viewer sees it, the waiting clock read with this board's money rules (w4's switch). */
  private requestView(
    r: RequestRecord,
    viewerDriverId?: string,
    drivers?: ReadonlyMap<string, RequestOfferDriver>,
    usualRange: UsualRange | null = null,
    riderName: string | null = null,
    memberNames?: Readonly<Record<string, string | null>>,
  ): RequestPostView {
    return requestViewOf(r, viewerDriverId, drivers, usualRange, this.requests.moneyRules, riderName, {
      // Step 6: the booker sees his friends' first names and the link. The picked driver never sees the
      // link; way C gives him the friends' first names while the trip is live, to say who got in.
      share: viewerDriverId ? this.requests.shareView(r, memberNames ?? null, false) : this.requests.shareView(r, memberNames ?? {}),
      shareable: this.requests.shareable(r),
    });
  }

  /**
   * Step 6: the first names of the friends in the booker's shared cars, one logged vault read. Way C:
   * the picked driver reads the friends still holding places, only while the trip is live.
   */
  private async shareNames(records: readonly RequestRecord[], viewerId: string, as: 'booker' | 'driver' = 'booker'): Promise<Record<string, string | null>> {
    const ids = [
      ...new Set(
        records
          .filter((r) => (as === 'booker' ? r.riderId === viewerId : (r.state === 'matched' || r.state === 'driver_arrived') && r.offers.some((o) => o.id === r.pickedOfferId && o.driverId === viewerId)))
          .flatMap((r) => r.share?.members.filter((m) => as === 'booker' || m.state === 'joined').map((m) => m.personId) ?? []),
      ),
    ];
    if (ids.length === 0 || !this.names) return {};
    return this.names.firstNamesFor(ids, viewerId, as === 'booker' ? 'request_share_member' : 'request_share_driver');
  }

  /**
   * Step 6: a shared car as a friend with the link sees it: the trip, the picked driver's card, the
   * booker's first name, the place price and his own places. No other friend and no other price.
   */
  private async inviteView(r: RequestRecord, personId: string): Promise<RequestShareInvite> {
    const s = r.share!;
    const picked = r.offers.filter((o) => o.id === r.pickedOfferId);
    const [drivers, booker] = await Promise.all([
      this.offerDrivers([{ ...r, offers: picked }], personId),
      this.names ? this.names.firstNamesFor([r.riderId], personId, 'request_share_booker') : Promise.resolve({} as Record<string, string | null>),
    ]);
    const rows = s.members.filter((m) => m.personId === personId);
    const mine = rows.find((m) => m.state === 'joined' || m.state === 'paid') ?? rows.at(-1) ?? null;
    const held = mine && (mine.state === 'joined' || mine.state === 'paid');
    const view = this.requests.shareView(r, null)!;
    return {
      code: s.code,
      postId: r.id,
      state: r.state,
      from: r.from,
      to: r.to,
      when: r.when,
      details: r.details,
      bookerName: booker[r.riderId] ?? null,
      driver: picked[0] ? (drivers.get(picked[0].driverId) ?? null) : null,
      people: r.seats,
      placeIqd: s.placeIqd,
      placesLeft: view.placesLeft,
      closesAt: view.closesAt,
      open: view.open,
      myPlaces: held ? mine.places : 0,
      myAmountIqd: held ? mine.amountIqd : 0,
      myState: mine?.state ?? null,
      driverArrivedAt: r.driverArrivedAt,
      myBoardedBy: held ? mine.boardedBy : null,
      boardNearM: this.departures.rules.requestBoard.shareBoardNearM,
    };
  }

  async openShare(actor: Actor, input: In<'openShare'>): Promise<RequestPostView> {
    return this.riderRequestView(await this.requests.openShare(actor.personId, input.postId, input.bookerPlaces ?? 1), actor.personId);
  }

  async shareInvite(actor: Actor, input: In<'shareInvite'>): Promise<RequestShareInvite> {
    const r = await this.requests.byShareCode(input.code);
    // The booker and the driver have their own screens; the link is for everyone else.
    if (r.riderId === actor.personId || r.offers.some((o) => o.id === r.pickedOfferId && o.driverId === actor.personId)) throw new DriverError('forbidden');
    // After the trip ends only someone who joined may still read it.
    const live = r.state === 'matched' || r.state === 'driver_arrived';
    if (!live && !r.share!.members.some((m) => m.personId === actor.personId)) throw new DriverError('share_not_found');
    return this.inviteView(r, actor.personId);
  }

  async joinShare(actor: Actor, input: In<'joinShare'>): Promise<RequestShareInvite> {
    return this.inviteView(await this.requests.joinShare(actor.personId, input.code, input.places ?? 1), actor.personId);
  }

  async leaveShare(actor: Actor, input: In<'leaveShare'>): Promise<RequestShareInvite> {
    return this.inviteView(await this.requests.leaveShare(actor.personId, input.code), actor.personId);
  }

  async shareBoard(actor: Actor, input: In<'shareBoard'>): Promise<RequestShareInvite> {
    return this.inviteView(await this.requests.boardShare(actor.personId, input.code, { lat: input.lat, lng: input.lng }), actor.personId);
  }

  async shareNotBoarded(actor: Actor, input: In<'shareNotBoarded'>): Promise<RequestShareInvite> {
    return this.inviteView(await this.requests.denyShareBoard(actor.personId, input.code), actor.personId);
  }

  async shareBoardFor(actor: Actor, input: In<'shareBoardFor'>): Promise<RequestPostView> {
    return this.pickedDriverView(await this.requests.boardShareFor(actor.personId, input.postId, input.memberId), actor.personId);
  }

  async sharedWithMe(actor: Actor): Promise<RequestShareInvite[]> {
    const rows = await this.requests.sharedWith(actor.personId);
    return Promise.all(rows.map((r) => this.inviteView(r, actor.personId)));
  }

  /**
   * k2: the names posters gave the people their «جيب واحد» trips fetch, one logged vault read for
   * `accessorId`: the poster himself (`request_rider_name`) or the driver he picked
   * (`partner_request_rider`); a driver who was not picked never gets the name.
   */
  private async fetchNames(records: readonly RequestRecord[], accessorId: string, as: 'poster' | 'driver'): Promise<Record<string, string>> {
    const ids = records
      .filter((r) => r.fetchPersonId && (as === 'poster' ? r.riderId === accessorId : r.offers.some((o) => o.id === r.pickedOfferId && o.driverId === accessorId)))
      .map((r) => r.id);
    if (ids.length === 0 || !this.requests.riders) return {};
    return this.requests.riders.names(ids, accessorId, as === 'poster' ? 'request_rider_name' : 'partner_request_rider');
  }

  /** The picked driver's view of a live or just-closed request, with the fetched person's name. */
  private async pickedDriverView(r: RequestRecord, driverId: string): Promise<RequestPostView> {
    const [names, members] = await Promise.all([this.fetchNames([r], driverId, 'driver'), this.shareNames([r], driverId, 'driver')]);
    return this.requestView(r, driverId, undefined, null, names[r.id] ?? null, members);
  }

  async myRequests(actor: Actor): Promise<RequestPostView[]> {
    const mine = await this.requests.mine(actor.personId);
    const [drivers, ranges, names, members] = await Promise.all([this.offerDrivers(mine, actor.personId), this.requests.usualRanges(mine), this.fetchNames(mine, actor.personId, 'poster'), this.shareNames(mine, actor.personId)]);
    return mine.map((r) => this.requestView(r, undefined, drivers, ranges.get(r.id) ?? null, names[r.id] ?? null, members));
  }

  async usualRange(_actor: Actor, input: In<'usualRange'>): Promise<UsualRange | null> {
    return this.requests.usualRange(input.placeId, input.trip);
  }

  async pickOffer(actor: Actor, input: In<'pickOffer'>): Promise<RequestPostView> {
    return this.riderRequestView(await this.requests.pick(actor.personId, input.postId, input.offerId, input.cash), actor.personId);
  }

  async askCash(actor: Actor, input: In<'askCash'>): Promise<RequestPostView> {
    return this.riderRequestView(await this.requests.askCash(actor.personId, input.postId, input.offerId), actor.personId);
  }

  async cancelRequest(actor: Actor, input: In<'cancelRequest'>): Promise<RequestPostView> {
    return this.riderRequestView(await this.requests.cancel(actor.personId, input.postId), actor.personId);
  }

  private async riderRequestView(r: RequestRecord, riderId: string): Promise<RequestPostView> {
    const [drivers, ranges, names, members] = await Promise.all([this.offerDrivers([r], riderId), this.requests.usualRanges([r]), this.fetchNames([r], riderId, 'poster'), this.shareNames([r], riderId)]);
    return this.requestView(r, undefined, drivers, ranges.get(r.id) ?? null, names[r.id] ?? null, members);
  }

  /** p2: a driver sees the same usual range the rider does, so offers start fair. */
  private async driverRequestView(r: RequestRecord, driverId: string): Promise<RequestPostView> {
    return this.requestView(r, driverId, undefined, (await this.requests.usualRanges([r])).get(r.id) ?? null);
  }

  /**
   * The offering drivers' cards for the rider (R-01): first names in one vault read (purpose
   * `intercity_driver_card`, the rider as accessor), and from each driver's latest departure his car
   * and whether he did a selfie check-in today, his record (y5: rating, trips, on-time share, badges)
   * and how many private trips he completed. Never a phone or a full name.
   */
  private async offerDrivers(records: readonly RequestRecord[], riderId: string): Promise<Map<string, RequestOfferDriver>> {
    const ids = [...new Set(records.flatMap((r) => r.offers.map((o) => o.driverId)))];
    const out = new Map<string, RequestOfferDriver>();
    if (ids.length === 0) return out;
    const now = this.departures.now();
    const names = this.names ? await this.names.firstNamesFor(ids, riderId, 'intercity_driver_card') : {};
    const photos = this.names?.driverPhotoUrls ? await this.names.driverPhotoUrls(ids, riderId, 'intercity_driver_card') : {};
    const [privateTrips, viewerTrips] = await Promise.all([this.repo.privateTripCounts(ids), this.repo.bookingsOfRider(riderId, ['completed'])]);
    for (const id of ids) {
      const deps = await this.repo.listDepartures({ driverId: id });
      const latest = deps.reduce<DepartureRecord | null>((a, d) => (!a || d.announcedAt > a.announcedAt ? d : a), null);
      const rep = await this.driverReputation(id, viewerTrips);
      const checkIn = deps.map((d) => d.selfieAt).filter((at): at is Date => at !== null && sameBaghdadDay(at, now));
      out.set(id, {
        firstName: names[id] ?? null,
        verifiedTodayAt: checkIn.length > 0 ? new Date(Math.max(...checkIn.map((d) => d.getTime()))) : null,
        // His approved main photo (Ali, 2026-10-06); none yet → the app draws the initial.
        photoUrl: photos[id] ?? null,
        vehicle: latest ? { ...latest.vehicle, layout: latest.layout } : null,
        // y5: his record on the seats board (same numbers as his departure card), once he has run one.
        stats: latest ? driverStats({ runs: rep.record.runs, rated: rep.record.rated, onTime: (run) => this.departures.runOnTime(run), viewerRides: rep.viewerRides, vehicle: latest.vehicle }) : null,
        privateTrips: privateTrips[id] ?? 0,
      });
    }
    return out;
  }

  async reportDriverNoShow(
    actor: Actor,
    input: In<'reportDriverNoShow'>,
  ): Promise<RequestPostView> {
    return this.riderRequestView(await this.requests.driverNoShow(actor.personId, input.postId), actor.personId);
  }

  // ───────────────────────── drivers ─────────────────────────

  async announce(actor: Actor, input: In<'announce'>): Promise<DriverDepartureView> {
    return this.driverView(await this.departures.announce(actor.personId, input));
  }

  async myDepartures(actor: Actor): Promise<DriverDepartureView[]> {
    const s = this.departures;
    const since = new Date(s.now().getTime() - 24 * 3600_000);
    const out: DriverDepartureView[] = [];
    for (const d of await this.repo.listDepartures({ driverId: actor.personId, from: since }))
      out.push(await this.driverView(d));
    return out;
  }

  async driverDeparture(actor: Actor, input: In<'driverDeparture'>): Promise<DriverDepartureView> {
    const dep = await this.departures.departure(input.departureId);
    if (dep.driverId !== actor.personId) throw new DriverError('not_departure_driver');
    return this.driverView(dep);
  }

  demandBoard(_actor: Actor, input: In<'demandBoard'>): Promise<DemandBucket[]> {
    return this.demand.board(input);
  }

  async selfie(actor: Actor, input: In<'selfie'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.selfie(actor.personId, input.departureId, input.selfieRef),
    );
  }

  async driverPosition(actor: Actor, input: In<'driverPosition'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.driverPosition(actor.personId, input.departureId, {
        lat: input.lat,
        lng: input.lng,
      }),
    );
  }

  async markWalkUp(actor: Actor, input: In<'markWalkUp'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.markWalkUp(actor.personId, input.departureId, input),
    );
  }

  async checkIn(actor: Actor, input: In<'checkIn'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.checkIn(actor.personId, input.departureId, input.pin, input.bookingId),
    );
  }

  /** Masked call to a rider on his own live run (garage mode "اتصل"); refused without a bridge. */
  async callRider(actor: Actor, input: In<'callRider'>): Promise<CallSession> {
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const riderId = await this.departures.riderForCall(actor.personId, input.departureId, input.bookingId, callId);
    if (!this.calls) throw new DriverError('call_unavailable');
    const session = await this.calls.open({ callId, orderId: input.departureId, callerId: actor.personId, calleeId: riderId }, this.departures.now());
    return { callId, mode: session.mode, dial: session.dial, counterpart: 'customer', expiresAt: session.expiresAt };
  }

  async markNoShow(actor: Actor, input: In<'markNoShow'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.markNoShow(actor.personId, input.departureId, input.bookingId),
    );
  }

  async respondPickup(actor: Actor, input: In<'respondPickup'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.respondPickup(
        actor.personId,
        input.departureId,
        input.bookingId,
        input.accept,
      ),
    );
  }

  async depart(actor: Actor, input: In<'depart'>): Promise<DriverDepartureView> {
    return this.driverView(await this.departures.depart(actor.personId, input.departureId));
  }

  async arrive(actor: Actor, input: In<'arrive'>): Promise<DriverDepartureView> {
    return this.driverView(await this.departures.arrive(actor.personId, input.departureId));
  }

  async cancelDeparture(actor: Actor, input: In<'cancelDeparture'>): Promise<DriverDepartureView> {
    return this.driverView(
      await this.departures.cancelByDriver(actor.personId, input.departureId, input.reason),
    );
  }

  // ───────────────────────── step 4: agreed trip prices ─────────────────────────

  async askAgreement(actor: Actor, input: In<'askAgreement'>): Promise<AgreementView> {
    return agreementView(await this.agreements.ask(actor.personId, input));
  }

  async withdrawAgreement(actor: Actor, input: In<'withdrawAgreement'>): Promise<AgreementView> {
    return agreementView(await this.agreements.withdraw(actor.personId, input.agreementId));
  }

  async respondAgreement(actor: Actor, input: In<'respondAgreement'>): Promise<AgreementView> {
    return agreementView(await this.agreements.respond(actor.personId, input));
  }

  async myAgreements(actor: Actor, input: In<'myAgreements'>): Promise<AgreementView[]> {
    return (await this.agreements.mine(actor.personId, input.departureId)).map((a) => agreementView(a));
  }

  async proposeAgreement(actor: Actor, input: In<'proposeAgreement'>): Promise<AgreementView> {
    const a = await this.agreements.propose(actor.personId, input);
    return agreementView(a, (await this.riderFirstNames([a.riderId], actor.personId))[a.riderId] ?? null);
  }

  /** The driver's view of every ask on his departure, each with the rider's first name (vault read logged). */
  async departureAgreements(actor: Actor, input: In<'departureAgreements'>): Promise<AgreementView[]> {
    const rows = await this.agreements.onDeparture(actor.personId, input.departureId);
    const names = await this.riderFirstNames(rows.map((a) => a.riderId), actor.personId);
    return rows.map((a) => agreementView(a, names[a.riderId] ?? null));
  }

  private async riderFirstNames(ids: readonly string[], accessorId: string): Promise<Record<string, string | null>> {
    if (!this.names || ids.length === 0) return {};
    return this.names.firstNamesFor([...new Set(ids)], accessorId, 'intercity_manifest');
  }

  /**
   * The riders on his own departure by first name (the rows `driverDeparture` lists), read from the
   * identity vault with purpose `intercity_manifest`. Without an identity reader names are null.
   */
  async driverRiders(actor: Actor, input: In<'driverRiders'>): Promise<DepartureRiderName[]> {
    const dep = await this.departures.departure(input.departureId);
    if (dep.driverId !== actor.personId) throw new DriverError('not_departure_driver');
    const rows = (await this.repo.bookingsFor(dep.id)).filter(
      (b) => LIVE.includes(b.state) || b.state === 'completed' || b.state === 'no_show',
    );
    const names = this.names
      ? await this.names.firstNamesFor(
          rows.map((b) => b.riderId),
          actor.personId,
          'intercity_manifest',
        )
      : {};
    return rows.map((b) => ({
      bookingId: b.id,
      riderId: b.riderId,
      firstName: names[b.riderId] ?? null,
    }));
  }

  /**
   * The departures a rider may ask about: still on the board, or one he holds (or held) a seat on.
   * Any other id is left out — no error, so nothing about it leaks.
   */
  private async visibleDepartures(riderId: string, ids: readonly string[]): Promise<DepartureRecord[]> {
    const visible: DepartureRecord[] = [];
    for (const id of new Set(ids)) {
      const dep = await this.repo.getDeparture(id);
      if (!dep) continue;
      const onBoard = OPEN_DEPARTURE.includes(dep.state);
      const mine = !onBoard && (await this.repo.bookingsFor(dep.id)).some((b) => b.riderId === riderId && (LIVE.includes(b.state) || b.state === 'completed'));
      if (onBoard || mine) visible.push(dep);
    }
    return visible;
  }

  /** A driver's record (x12, x16) and how many of the viewer's finished trips were with him (x17). */
  private async driverReputation(driverId: string, viewerTrips: readonly BookingRecord[]): Promise<{ record: DriverRecord; viewerRides: number }> {
    const record = await this.repo.driverRecord(driverId);
    const runIds = new Set(record.runs.map((d) => d.id));
    const viewerRides = new Set(viewerTrips.filter((b) => runIds.has(b.departureId)).map((b) => b.departureId)).size;
    return { record, viewerRides };
  }

  /**
   * Riders (audit C-19): who drives each departure — first name (vault read, purpose
   * `intercity_driver_card`, the rider as accessor), today's selfie check-in for this run, his approved
   * main photo (Ali, 2026-10-06), and his record (x16: rating, trips, on-time share, the two things
   * riders say most, badges; x17: trips the rider took with him).
   */
  async driverCards(actor: Actor, input: In<'driverCards'>): Promise<RajaaDriverCard[]> {
    const visible = await this.visibleDepartures(actor.personId, input.departureIds);
    return (await this.cardsWithRecords(actor.personId, visible)).cards;
  }

  /** Cards for visible departures, with each driver's record (read once per driver). */
  private async cardsWithRecords(viewerId: string, visible: readonly DepartureRecord[]): Promise<{ cards: RajaaDriverCard[]; records: Map<string, DriverRecord> }> {
    if (visible.length === 0) return { cards: [], records: new Map() };
    const driverIds = [...new Set(visible.map((d) => d.driverId))];
    const [names, photos, viewerTrips] = await Promise.all([
      this.names ? this.names.firstNamesFor(driverIds, viewerId, 'intercity_driver_card') : Promise.resolve({} as Record<string, string | null>),
      this.names?.driverPhotoUrls ? this.names.driverPhotoUrls(driverIds, viewerId, 'intercity_driver_card') : Promise.resolve({} as Record<string, string | null>),
      this.repo.bookingsOfRider(viewerId, ['completed']),
    ]);
    const reps = new Map(await Promise.all(driverIds.map(async (id) => [id, await this.driverReputation(id, viewerTrips)] as const)));
    return {
      cards: visible.map((d) => this.card(d, names, photos, reps.get(d.driverId)!)),
      records: new Map([...reps].map(([id, r]) => [id, r.record])),
    };
  }

  private card(
    d: DepartureRecord,
    names: Record<string, string | null>,
    photos: Record<string, string | null>,
    rep: { record: DriverRecord; viewerRides: number },
  ): RajaaDriverCard {
    return {
      departureId: d.id,
      driverId: d.driverId,
      firstName: names[d.driverId] ?? null,
      verifiedTodayAt: d.selfieAt && sameBaghdadDay(d.selfieAt, this.departures.now()) ? d.selfieAt : null,
      // His approved main photo (Ali, 2026-10-06); none yet → the app draws the initial.
      photoUrl: photos[d.driverId] ?? null,
      stats: driverStats({
        runs: rep.record.runs,
        rated: rep.record.rated,
        onTime: (run) => this.departures.runOnTime(run),
        viewerRides: rep.viewerRides,
        vehicle: d.vehicle,
      }),
    };
  }

  /**
   * «ملفه» (x12–x17): the full profile of a departure's driver — his card and record, this run's car,
   * when he started, a bar per quality and the newest shown reviews (no names, month only). Same
   * visibility as `driverCards`; anything else is `departure_not_found`.
   */
  async driverProfile(actor: Actor, input: In<'driverProfile'>): Promise<RajaaDriverProfile> {
    const [dep] = await this.visibleDepartures(actor.personId, [input.departureId]);
    if (!dep) throw new DriverError('departure_not_found');
    const { cards, records } = await this.cardsWithRecords(actor.personId, [dep]);
    const record = records.get(dep.driverId)!;
    const { reviews, count } = publicReviews(record.rated);
    return {
      card: cards[0]!,
      vehicle: { ...dep.vehicle, layout: dep.layout },
      firstTripAt: firstTripAt(record.runs),
      qualities: qualityBars(record.rated),
      reviews,
      reviewCount: count,
    };
  }

  async openRequests(actor: Actor, input: In<'openRequests'>): Promise<RequestPostView[]> {
    const open = await this.requests.listOpen(actor.personId, input?.cityId);
    const ranges = await this.requests.usualRanges(open);
    return open.map((r) => this.requestView(r, actor.personId, undefined, ranges.get(r.id) ?? null));
  }

  async requestSeen(actor: Actor, input: In<'requestSeen'>): Promise<RequestPostView> {
    return this.driverRequestView(await this.requests.seen(actor.personId, input.postId), actor.personId);
  }

  async offerOnRequest(actor: Actor, input: In<'offerOnRequest'>): Promise<RequestPostView> {
    return this.driverRequestView(
      await this.requests.offer(actor.personId, input.postId, input.priceIqd, input.wait),
      actor.personId,
    );
  }

  async answerCash(actor: Actor, input: In<'answerCash'>): Promise<RequestPostView> {
    return this.driverRequestView(await this.requests.answerCash(actor.personId, input.postId, input.offerId, input.accept), actor.personId);
  }

  async requestArrived(actor: Actor, input: In<'requestArrived'>): Promise<RequestPostView> {
    return this.pickedDriverView(await this.requests.arrived(actor.personId, input.postId, { lat: input.lat, lng: input.lng }), actor.personId);
  }

  async requestWaitStart(actor: Actor, input: In<'requestWaitStart'>): Promise<RequestPostView> {
    return this.pickedDriverView(await this.requests.waitStart(actor.personId, input.postId), actor.personId);
  }

  async requestWaitEnd(actor: Actor, input: In<'requestWaitEnd'>): Promise<RequestPostView> {
    return this.pickedDriverView(await this.requests.waitEnd(actor.personId, input.postId), actor.personId);
  }

  /** k2: the picked driver calls the person he fetches (or the poster) over the masked-call bridge. */
  async requestCall(actor: Actor, input: In<'requestCall'>): Promise<CallSession> {
    if (!this.calls) throw new DriverError('call_unavailable');
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const { calleeId } = await this.requests.callee(actor.personId, input.postId, callId);
    const session = await this.calls.open({ callId, orderId: input.postId, callerId: actor.personId, calleeId }, this.departures.now());
    return { callId, mode: session.mode, dial: session.dial, counterpart: 'customer', expiresAt: session.expiresAt };
  }

  async requestCompleted(actor: Actor, input: In<'requestCompleted'>): Promise<RequestPostView> {
    return this.pickedDriverView(await this.requests.complete(actor.personId, input.postId), actor.personId);
  }

  async reportRiderNoShow(actor: Actor, input: In<'reportRiderNoShow'>): Promise<RequestPostView> {
    return this.pickedDriverView(await this.requests.riderNoShow(actor.personId, input.postId), actor.personId);
  }

  /** Rides where the rider picked this driver's offer: live ones, and those closed in the last 12 h. */
  async myRequestRides(actor: Actor): Promise<DriverRequestRide[]> {
    const now = this.departures.now().getTime();
    const rb = this.departures.rules.requestBoard;
    const rows = await this.repo.listRequests({
      states: ['matched', 'driver_arrived', 'completed', 'rider_no_show', 'cancelled', 'driver_no_show'],
    });
    const out: DriverRequestRide[] = [];
    const mine = rows.filter((r) => {
      const picked = r.offers.find((o) => o.id === r.pickedOfferId);
      return picked?.driverId === actor.personId && !(r.closedAt && now - r.closedAt.getTime() > 12 * 3600_000);
    });
    const [names, members] = await Promise.all([this.fetchNames(mine, actor.personId, 'driver'), this.shareNames(mine, actor.personId, 'driver')]);
    for (const r of mine) {
      const picked = r.offers.find((o) => o.id === r.pickedOfferId)!;
      // 4b: a cash reservation held nothing on the wallet, so all of it is cash.
      const deposit = r.cashReserved ? 0 : (r.depositIqd ?? 0);
      out.push({
        ...this.requestView(r, actor.personId, undefined, null, names[r.id] ?? null, members),
        priceIqd: picked.priceIqd,
        driverArrivedAt: r.driverArrivedAt,
        riderNoShowAt: r.driverArrivedAt
          ? new Date(
              Math.max(r.driverArrivedAt.getTime(), r.when.getTime()) +
                rb.riderNoShowWaitMin * MIN_MS,
            )
          : null,
        // w4: extra waiting (when switched on) is cash too: counted so far, fixed once the clock stops.
        // Step 6: places friends paid from their wallets come off the cash too.
        cashToCollectIqd: Math.max(0, picked.priceIqd + this.requests.waitExtra(r) - deposit - sharedIqd(r.share)),
      });
    }
    return out.sort((a, b) => a.when.getTime() - b.when.getTime());
  }

  // ───────────────────────── ops ─────────────────────────

  async garageView(_actor: Actor, input: In<'garageView'>): Promise<GarageOpsView> {
    const s = this.departures;
    const g = s.garage(input.garageId);
    const now = s.now();
    const from = input.from ?? new Date(now.getTime() - 6 * 3600_000);
    const to = input.to ?? new Date(now.getTime() + 24 * 3600_000);
    const deps = await this.repo.listDepartures({ garageId: g.id, from, to });
    const departures: DriverDepartureView[] = [];
    const stranded: GarageOpsView['stranded'] = [];
    for (const d of deps) {
      const bookings = await this.repo.bookingsFor(d.id);
      departures.push(driverDepartureView(s, d, bookings));
      for (const b of bookings)
        if (
          b.state === 'cancelled' &&
          (d.state === 'cancelled_by_driver' ||
            d.state === 'cancelled_low_fill' ||
            b.lateMinutes !== null)
        )
          stranded.push({
            bookingId: b.id,
            riderId: b.riderId,
            departureId: d.id,
            at: b.cancelledAt ?? d.cancelledAt ?? now,
          });
    }
    const demand: DemandBucket[] = [];
    for (const c of s.network.corridors.filter(
      (c) => g.cityId === 'aziziyah' || c.cityId === g.cityId,
    ))
      demand.push(
        ...(await this.demand.board({
          corridorId: c.id,
          direction: directionFrom(g.cityId),
          from: now,
          to,
          garageId: g.id,
        })),
      );
    const openRequests = (
      await this.repo.listRequests({ states: ['open', 'matched', 'driver_arrived'] })
    )
      .filter((r) => r.from.garageId === g.id || r.cityId === g.cityId)
      .map((r) => this.requestView(r));
    return { garage: garageView(g), departures, demand, openRequests, stranded };
  }

  /**
   * The Console safety strip's PIN rows (Ali 2026-10-06): the city's attempts that alerted ops in the
   * last `PIN_ATTEMPT_RULES.alertShowMin`, newest first, each with its car and the car's whole PIN
   * history. The drivers' names and masked numbers are one logged vault read for the staff member.
   */
  async pinAlerts(actor: Actor, input: In<'pinAlerts'>): Promise<PinAlertView[]> {
    const s = this.departures;
    const since = new Date(s.now().getTime() - PIN_ATTEMPT_RULES.alertShowMin * MIN_MS);
    const alerts = await this.repo.pinAlertsSince(input.cityId, since);
    if (alerts.length === 0) return [];
    const cards = this.names ? await this.names.memberCards([...new Set(alerts.map((a) => a.driverId))], actor.personId, 'intercity_pin_alert') : {};
    const out: PinAlertView[] = [];
    const history = new Map<string, { dep: DepartureRecord; bookings: BookingRecord[]; attempts: PinAttemptRecord[] }>();
    for (const a of alerts) {
      if (a.alert === null) continue;
      let h = history.get(a.departureId);
      if (!h) {
        const dep = await s.departure(a.departureId);
        h = { dep, bookings: await this.repo.bookingsFor(dep.id), attempts: await s.pinAttempts(dep.id) };
        history.set(a.departureId, h);
      }
      const seats = seatsOfBooking(h.bookings);
      const card = cards[a.driverId];
      out.push({
        alertId: a.id,
        kind: a.alert,
        cityId: a.cityId,
        departureId: h.dep.id,
        garageNameAr: s.garage(h.dep.garageId).nameAr,
        corridorNameAr: s.corridor(h.dep.corridorId).nameAr,
        departAt: h.dep.departAt,
        driver: { personId: a.driverId, displayName: card?.name ? shortDisplayName(card.name) || null : null, phoneMasked: card?.phoneMasked ?? null },
        targetBookingId: a.targetBookingId,
        targetSeatIds: seats(a.targetBookingId),
        matchedBookingId: a.matchedBookingId,
        matchedSeatIds: seats(a.matchedBookingId),
        refusedOnSeat: a.refusedOnSeat,
        raisedAt: a.at,
        attempts: h.attempts.map((x) => pinAttemptView(x, seats)),
      });
    }
    return out;
  }

  /** Any departure's PIN history for ops, oldest first (ids and seats only). */
  async pinAttempts(_actor: Actor, input: In<'pinAttempts'>): Promise<PinAttemptView[]> {
    const dep = await this.departures.departure(input.departureId);
    const seats = seatsOfBooking(await this.repo.bookingsFor(dep.id));
    return (await this.departures.pinAttempts(dep.id)).map((a) => pinAttemptView(a, seats));
  }

  /** The PIN row's call button: a masked call from the staff member to the car's driver, on the departure's log. */
  async callPinAlertDriver(actor: Actor, input: In<'callPinAlertDriver'>): Promise<SafetyCallSession> {
    const alert = await this.repo.getPinAttempt(input.alertId);
    if (!alert || alert.alert === null) throw new DriverError('not_found');
    if (!this.calls) throw new DriverError('call_unavailable');
    const callId = `call_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const session = await this.calls.open({ callId, orderId: alert.departureId, callerId: actor.personId, calleeId: alert.driverId }, this.departures.now());
    await this.departures.logPinAlertCall(actor.personId, alert, callId, session.mode);
    return { mode: session.mode, dial: session.dial, expiresAt: session.expiresAt };
  }

  /**
   * Console «كلام الركاب» (x14): written reviews, newest first, each with the driver's first name (one
   * logged vault read, purpose `review_moderation`) and the rider's id — never his name or number.
   */
  async reviews(actor: Actor, input: In<'reviews'>): Promise<ReviewOpsView[]> {
    const rows = await this.repo.reviews({ limit: input.limit, ...(input.hidden === undefined ? {} : { hidden: input.hidden }), ...(input.cursor ? { before: input.cursor } : {}) });
    return this.reviewViews(actor, rows);
  }

  async hideReview(actor: Actor, input: In<'hideReview'>): Promise<ReviewOpsView> {
    const [view] = await this.reviewViews(actor, [await this.departures.hideReview(actor.personId, input.bookingId, input.reason)]);
    return view!;
  }

  async unhideReview(actor: Actor, input: In<'unhideReview'>): Promise<ReviewOpsView> {
    const [view] = await this.reviewViews(actor, [await this.departures.unhideReview(actor.personId, input.bookingId)]);
    return view!;
  }

  // ── W3 staff way-outs (NTF-10, NTF-14) ──

  async opsCancelDeparture(actor: Actor, input: In<'opsCancelDeparture'>): Promise<StaffDepartureResult> {
    return this.staffOrThrow().cancel(actor, input);
  }

  async opsArriveDeparture(actor: Actor, input: In<'opsArriveDeparture'>): Promise<StaffDepartureResult> {
    return this.staffOrThrow().arrive(actor, input);
  }

  async opsCloseDeparture(actor: Actor, input: In<'opsCloseDeparture'>): Promise<StaffDepartureResult> {
    return this.staffOrThrow().close(actor, input);
  }

  async overdueDepartures(_actor: Actor, input: In<'overdueDepartures'>): Promise<OverdueDeparture[]> {
    return this.staffOrThrow().overdue(input);
  }

  /**
   * Who drives each departure, whatever its state: the Console garage view names the driver of a run
   * that left or is overdue (riders' `driverCards` stop at the board). Name and masked number are one
   * fail-closed staff vault read (purpose `intercity_ops_departure`); unknown ids are skipped.
   */
  async departureDrivers(actor: Actor, input: In<'departureDrivers'>): Promise<StaffDepartureDriver[]> {
    const deps: DepartureRecord[] = [];
    for (const id of new Set(input.departureIds)) {
      const dep = await this.repo.getDeparture(id);
      if (dep) deps.push(dep);
    }
    if (deps.length === 0) return [];
    const cards = this.names ? await this.names.memberCards([...new Set(deps.map((d) => d.driverId))], actor.personId, 'intercity_ops_departure') : {};
    return deps.map((d) => {
      const card = cards[d.driverId];
      return { departureId: d.id, driverId: d.driverId, displayName: card?.name ? shortDisplayName(card.name) || null : null, phoneMasked: card?.phoneMasked ?? null };
    });
  }

  private staffOrThrow(): DeparturesStaffService {
    if (!this.staff) throw new DriverError('internal');
    return this.staff;
  }

  private async reviewViews(actor: Actor, rows: readonly BookingRecord[]): Promise<ReviewOpsView[]> {
    const deps = new Map<string, DepartureRecord>();
    for (const b of rows) if (!deps.has(b.departureId)) deps.set(b.departureId, await this.departures.departure(b.departureId));
    const driverIds = [...new Set([...deps.values()].map((d) => d.driverId))];
    const names = this.names && driverIds.length ? await this.names.firstNamesFor(driverIds, actor.personId, 'review_moderation') : {};
    return rows.map((b) => {
      const dep = deps.get(b.departureId)!;
      const review = b.review!;
      return {
        bookingId: b.id,
        departureId: dep.id,
        driverId: dep.driverId,
        driverFirstName: names[dep.driverId] ?? null,
        riderId: b.riderId,
        stars: b.rating?.stars ?? 0,
        tags: b.rating?.tags ?? [],
        text: review.text,
        at: review.at,
        corridorId: dep.corridorId,
        direction: dep.direction,
        hiddenAt: review.hiddenAt,
        hiddenBy: review.hiddenBy,
        hiddenReason: review.hiddenReason,
      };
    });
  }

  // ───────────────────────── helpers ─────────────────────────

  private async view(b: BookingRecord, owner: boolean): Promise<BookingView> {
    const dep = await this.departures.departure(b.departureId);
    const points = owner && b.state === 'completed' && this.points ? await this.points.pointsForBooking(b.riderId, b.id) : null;
    return bookingView(this.departures, b, dep, owner && LIVE.includes(b.state), points);
  }

  private async driverView(dep: DepartureRecord): Promise<DriverDepartureView> {
    return driverDepartureView(this.departures, dep, await this.repo.bookingsFor(dep.id));
  }
}

/** Seats each booking on the car holds (empty for the plain PIN pad or an unknown booking). */
function seatsOfBooking(bookings: readonly BookingRecord[]): (id: string | null) => BookingRecord['seatIds'] {
  return (id) => (id ? (bookings.find((b) => b.id === id)?.seatIds ?? []) : []);
}

function pinAttemptView(a: PinAttemptRecord, seats: (id: string | null) => BookingRecord['seatIds']): PinAttemptView {
  return {
    attemptId: a.id,
    at: a.at,
    driverId: a.driverId,
    targetBookingId: a.targetBookingId,
    targetSeatIds: seats(a.targetBookingId),
    matchedBookingId: a.matchedBookingId,
    matchedSeatIds: seats(a.matchedBookingId),
    result: a.result,
    alert: a.alert,
  };
}
