import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type BoardInput,
  type BoardingPass,
  type BookingView,
  type DemandBucket,
  type DemandPostView,
  type DepartureRiderName,
  type DriverDepartureView,
  type DriverRequestRide,
  type GarageOpsView,
  type ImHereOutput,
  type IntercityBoard,
  type IntercityNetwork,
  type RajaaDriverCard,
  type RequestPostView,
  type RoutesPort,
} from '@driver/contracts';
import { DemandService } from './demand.service.js';
import { DeparturesService } from './departures.service.js';
import { directionFrom } from './intercity.config.js';
import { riderMeterMinutes } from './late-meter.js';
import { LIVE, OPEN_DEPARTURE, type BookingRecord, type DepartureRecord } from './model.js';
import { RequestBoardService } from './request-board.service.js';
import { ROUTES_REPOSITORY, type RoutesRepository } from './routes.repository.js';
import { MIN_MS } from './support.js';
import { ROUTES_CONTROLS, ROUTES_RIDER_NAMES, type RiderNamesReader, type RoutesControlsPort } from './tokens.js';
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
  requestView,
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
    @Inject(ROUTES_REPOSITORY) private readonly repo: RoutesRepository,
    @Optional() @Inject(ROUTES_RIDER_NAMES) private readonly names: RiderNamesReader | null = null,
    @Optional() @Inject(ROUTES_CONTROLS) private readonly controls: RoutesControlsPort | null = null,
  ) {}

  /** Seats booked (held seats that were booked, any later state but cancelled) since `since` — launch wall. */
  async seatsBookedSince(since: Date): Promise<number> {
    let seats = 0;
    for (const d of await this.repo.listDepartures({ from: new Date(since.getTime() - 86_400_000) })) {
      for (const b of await this.repo.bookingsFor(d.id)) {
        if (b.bookedAt && b.bookedAt.getTime() >= since.getTime() && !['cancelled', 'cancelled_by_rider', 'expired'].includes(b.state)) seats += b.seatIds.length;
      }
    }
    return seats;
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
    return requestView(await this.requests.post(actor.personId, input));
  }

  async myRequests(actor: Actor): Promise<RequestPostView[]> {
    return (await this.requests.mine(actor.personId)).map((r) => requestView(r));
  }

  async pickOffer(actor: Actor, input: In<'pickOffer'>): Promise<RequestPostView> {
    return requestView(await this.requests.pick(actor.personId, input.postId, input.offerId));
  }

  async cancelRequest(actor: Actor, input: In<'cancelRequest'>): Promise<RequestPostView> {
    return requestView(await this.requests.cancel(actor.personId, input.postId));
  }

  async reportDriverNoShow(
    actor: Actor,
    input: In<'reportDriverNoShow'>,
  ): Promise<RequestPostView> {
    return requestView(await this.requests.driverNoShow(actor.personId, input.postId));
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
      await this.departures.checkIn(actor.personId, input.departureId, input.pin),
    );
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
   * Riders (audit C-19): who drives each departure — first name (vault read, purpose
   * `intercity_driver_card`, the rider as accessor), today's selfie check-in for this run, and a
   * photo once public portraits exist. Only departures still on the board, or ones the rider holds
   * a seat on, are answered; any other id is left out (no error, nothing about it leaks).
   */
  async driverCards(actor: Actor, input: In<'driverCards'>): Promise<RajaaDriverCard[]> {
    const now = this.departures.now();
    const visible: DepartureRecord[] = [];
    for (const id of [...new Set(input.departureIds)]) {
      const dep = await this.repo.getDeparture(id);
      if (!dep) continue;
      const onBoard = OPEN_DEPARTURE.includes(dep.state);
      const mine = !onBoard && (await this.repo.bookingsFor(dep.id)).some((b) => b.riderId === actor.personId && (LIVE.includes(b.state) || b.state === 'completed'));
      if (onBoard || mine) visible.push(dep);
    }
    if (visible.length === 0) return [];
    const names = this.names ? await this.names.firstNamesFor([...new Set(visible.map((d) => d.driverId))], actor.personId, 'intercity_driver_card') : {};
    return visible.map((d) => ({
      departureId: d.id,
      driverId: d.driverId,
      firstName: names[d.driverId] ?? null,
      verifiedTodayAt: d.selfieAt && sameBaghdadDay(d.selfieAt, now) ? d.selfieAt : null,
      // TODO(identity): a public driver portrait (selfies stay in the vault); the app draws the initial.
      photoUrl: null,
    }));
  }

  async openRequests(actor: Actor, input: In<'openRequests'>): Promise<RequestPostView[]> {
    return (await this.requests.listOpen(actor.personId, input?.cityId)).map((r) =>
      requestView(r, actor.personId),
    );
  }

  async offerOnRequest(actor: Actor, input: In<'offerOnRequest'>): Promise<RequestPostView> {
    return requestView(
      await this.requests.offer(actor.personId, input.postId, input.priceIqd),
      actor.personId,
    );
  }

  async requestArrived(actor: Actor, input: In<'requestArrived'>): Promise<RequestPostView> {
    return requestView(
      await this.requests.arrived(actor.personId, input.postId, { lat: input.lat, lng: input.lng }),
      actor.personId,
    );
  }

  async requestCompleted(actor: Actor, input: In<'requestCompleted'>): Promise<RequestPostView> {
    return requestView(await this.requests.complete(actor.personId, input.postId), actor.personId);
  }

  async reportRiderNoShow(actor: Actor, input: In<'reportRiderNoShow'>): Promise<RequestPostView> {
    return requestView(
      await this.requests.riderNoShow(actor.personId, input.postId),
      actor.personId,
    );
  }

  /** Rides where the rider picked this driver's offer: live ones, and those closed in the last 12 h. */
  async myRequestRides(actor: Actor): Promise<DriverRequestRide[]> {
    const now = this.departures.now().getTime();
    const rb = this.departures.rules.requestBoard;
    const rows = await this.repo.listRequests({
      states: ['matched', 'driver_arrived', 'completed', 'rider_no_show', 'cancelled', 'driver_no_show'],
    });
    const out: DriverRequestRide[] = [];
    for (const r of rows) {
      const picked = r.offers.find((o) => o.id === r.pickedOfferId);
      if (!picked || picked.driverId !== actor.personId) continue;
      if (r.closedAt && now - r.closedAt.getTime() > 12 * 3600_000) continue;
      const deposit = r.depositIqd ?? 0;
      out.push({
        ...requestView(r, actor.personId),
        priceIqd: picked.priceIqd,
        driverArrivedAt: r.driverArrivedAt,
        riderNoShowAt: r.driverArrivedAt
          ? new Date(
              Math.max(r.driverArrivedAt.getTime(), r.when.getTime()) +
                rb.riderNoShowWaitMin * MIN_MS,
            )
          : null,
        cashToCollectIqd: Math.max(0, picked.priceIqd - deposit),
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
      .map((r) => requestView(r));
    return { garage: garageView(g), departures, demand, openRequests, stranded };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async view(b: BookingRecord, owner: boolean): Promise<BookingView> {
    const dep = await this.departures.departure(b.departureId);
    return bookingView(this.departures, b, dep, owner && LIVE.includes(b.state));
  }

  private async driverView(dep: DepartureRecord): Promise<DriverDepartureView> {
    return driverDepartureView(this.departures, dep, await this.repo.bookingsFor(dep.id));
  }
}
