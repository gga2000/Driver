import { Inject, Injectable } from '@nestjs/common';
import {
  DEMAND_MAP_RULES,
  DriverError,
  sortCargo,
  PARTNER_DRIVING_ROLES,
  partnerCurrentStop,
  partnerModesOf,
  type Actor,
  type AnswerClimateCheckInput,
  type AnswerBookedJobInput,
  type Order,
  type OrderRoute,
  type PartnerBookedJob,
  type PartnerBookedJobs,
  type PartnerDemandMap,
  type PartnerGoOnlineInput,
  type PartnerGoOnlineResult,
  type PartnerHeartbeatAck,
  type PartnerJob,
  type PartnerDoor,
  type PartnerPickupSpot,
  type PartnerJobStop,
  type PartnerMerchantPrep,
  type PartnerClimateCheck,
  type PartnerOffer,
  type PartnerOfferRouteInput,
  type PartnerPort,
  type PartnerStatus,
  type QuoteComponent,
  type RideCargo,
  type RoleKind,
  type VehicleClass,
  type Trip,
} from '@driver/contracts';
import { pickupCodeFor } from '../../shared/pickup-code.js';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { FAVOURITE_OFFER_POLICY, servedVerticals } from '../dispatch/index.js';
import { buildPay, demandHint, demandZones, forecastWindows, gateAllowsHeartbeat, gateErrorCode, kmBetween, merchantPrep, NEAR_CAP_SHARE, nearestLandmark, offerClimate, startOfLocalDay, todayFromLines, workStateVersion } from './logic.js';
import { DEFAULT_CITY, PARTNER_DEPS, type PartnerBookedRecord, type PartnerDeps, type PartnerPresence } from './ports.js';

/** x5: what the riders on these orders carry (a ride has one order; a batch of food has none). */
function cargoOf(orders: readonly Order[]): RideCargo[] {
  return sortCargo(orders.flatMap((o) => (o.type === 'ride' ? (o.rideCargo ?? []) : [])));
}

/** The demand forecast is re-read at most this often per city. */
const FORECAST_CACHE_MS = 5 * 60_000;

/**
 * `ctx.partner`: the Driver Partner app's own reads and presence. Composes dispatch (presence in
 * the geo index, the open offer, the board for demand), trips (the job), orders + orgs (pay, cash
 * to collect, the kitchen) and the ledger (cash vs cap, today's earnings). Owns no tables; every
 * read is the actor's own (authorization by role happens in the router).
 */
@Injectable()
export class PartnerService implements PartnerPort {
  private readonly forecasts = new Map<string, { bucket: number; byZone: Map<string, number> }>();

  constructor(
    @Inject(PARTNER_DEPS) private readonly deps: PartnerDeps,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async status(actor: Actor): Promise<PartnerStatus> {
    const id = actor.personId;
    const now = this.clock.now();
    const [roles, presence, cap, lines, trips, registered] = await Promise.all([
      this.deps.roles.activeRoles(id),
      this.deps.presence.get(id),
      this.deps.money.cap(id),
      this.deps.money.driverLines(id, startOfLocalDay(now)),
      this.deps.trips.forDriver(id),
      this.deps.vehicles.vehicleOf(id),
    ]);
    const modes = partnerModesOf(roles);
    const canDrive = roles.some((r) => PARTNER_DRIVING_ROLES.includes(r));
    const cityId = presence?.cityId ?? DEFAULT_CITY;
    const [offer, demand, gate, climateCheck] = await Promise.all([
      canDrive && presence ? this.deps.dispatch.openOffer(id, cityId) : Promise.resolve(null),
      canDrive ? this.demand(cityId, presence) : Promise.resolve(null),
      canDrive ? this.deps.gate.onlineGate(id) : Promise.resolve(null),
      presence ? this.climateCheckOf(id, roles, presence.vehicle) : Promise.resolve(null),
    ]);
    const heldIqd = Math.max(0, -cap.cashIqd);
    return {
      personId: id,
      roles,
      modes,
      primaryMode: modes[0] ?? null,
      canDrive,
      online: presence !== null,
      onlineSince: presence?.onlineSince ? new Date(presence.onlineSince) : null,
      vehicleClass: presence?.vehicle ?? registered,
      tier: cap.tier,
      zoneId: presence?.zoneId ?? null,
      position: presence ? { lat: presence.lat, lng: presence.lng } : null,
      cash: {
        heldIqd,
        owedIqd: cap.owedIqd,
        capIqd: cap.capIqd,
        remainingIqd: cap.capRemainingIqd,
        overCap: cap.overCap,
        nearCap: cap.capIqd > 0 && cap.owedIqd >= cap.capIqd * NEAR_CAP_SHARE,
      },
      today: todayFromLines(lines),
      demand,
      activeTripId: trips[0]?.id ?? null,
      offerId: offer?.offer.id ?? null,
      gate,
      climateCheck,
    };
  }

  /**
   * Ride idea x1, «المكيّفة شغالة اليوم؟»: asked of an online ride driver on a car on a hot (cold)
   * shift when ops confirmed its AC (heating); null otherwise. Couriers and tuktuks are never asked.
   */
  private async climateCheckOf(driverId: string, roles: readonly RoleKind[], vehicle: VehicleClass): Promise<PartnerClimateCheck | null> {
    const climate = this.deps.climate;
    if (!climate || !servedVerticals(roles, vehicle).includes('taxi')) return null;
    return climate.check(driverId);
  }

  /** نعم / لا for this shift; only while the question stands (`climate_check_none` otherwise). */
  async answerClimateCheck(actor: Actor, input: AnswerClimateCheckInput): Promise<PartnerStatus> {
    const id = actor.personId;
    const [roles, presence] = await Promise.all([this.deps.roles.activeRoles(id), this.deps.presence.get(id)]);
    const check = presence ? await this.climateCheckOf(id, roles, presence.vehicle) : null;
    if (!check || !this.deps.climate) throw new DriverError('climate_check_none');
    await this.deps.climate.answer(id, input.working);
    return this.status(actor);
  }

  /**
   * Go online, and the heartbeat that keeps him there. Scoring §2: no daily check-in, a lock-out after
   * two failed check-ins or an expired document keep him offline. A refused call while he is online
   * (the heartbeat) also takes him out of the index, except for the check-in alone between local
   * midnight and 04:00 (`gateAllowsHeartbeat`).
   *
   * Perf o4: an app that sends `knownVersion` gets the small `PartnerHeartbeatAck` — when his work
   * state still has that version, only `{ changed: false, version }`, without building the status;
   * otherwise the full status with its new version. Without `knownVersion`, the full status as before,
   * so older apps keep working.
   */
  goOnline(actor: Actor, input: Omit<PartnerGoOnlineInput, 'knownVersion'> & { knownVersion?: undefined }): Promise<PartnerStatus>;
  goOnline(actor: Actor, input: PartnerGoOnlineInput & { knownVersion: string }): Promise<PartnerHeartbeatAck>;
  goOnline(actor: Actor, input: PartnerGoOnlineInput): Promise<PartnerGoOnlineResult>;
  async goOnline(actor: Actor, input: PartnerGoOnlineInput): Promise<PartnerGoOnlineResult> {
    const beat = await this.beat(actor, input);
    if (input.knownVersion === undefined) return this.status(actor);
    const id = actor.personId;
    const [trips, offer, climateCheck] = await Promise.all([
      this.deps.trips.forDriver(id),
      this.deps.dispatch.openOffer(id, beat.presence.cityId),
      this.climateCheckOf(id, beat.roles, beat.presence.vehicle),
    ]);
    const version = workStateVersion({ ...beat, tripIds: trips.map((t) => t.id), offerId: offer?.offer.id ?? null, climateCheck });
    if (version === input.knownVersion) return { changed: false, version };
    return { changed: true, version, status: await this.status(actor) };
  }

  /** Checks the gate and the vehicle, then marks him online; what it read is half his work state (o4). */
  private async beat(actor: Actor, input: PartnerGoOnlineInput) {
    const id = actor.personId;
    const [gate, present] = await Promise.all([this.deps.gate.onlineGate(id), this.deps.presence.get(id)]);
    if (!gateAllowsHeartbeat(gate, present !== null, this.clock.now())) {
      if (present) await this.deps.presence.offline(id);
      throw new DriverError(gateErrorCode(gate.reasons));
    }
    const [cap, registered, roles] = await Promise.all([this.deps.money.cap(id), this.deps.vehicles.vehicleOf(id), this.deps.roles.activeRoles(id)]);
    // Backend review 2026-10-04 #20: the vehicle is the registered one (fleet / driver-account
    // registry), never what the app declares; nothing registered is a bike. What he may be offered
    // follows his roles on that vehicle, and dispatch filters candidates by it.
    const vehicle = registered ?? 'bike';
    if (input.vehicleClass && input.vehicleClass !== vehicle) throw new DriverError('vehicle_not_registered');
    const verticals = servedVerticals(roles, vehicle);
    if (verticals.length === 0) {
      if (present) await this.deps.presence.offline(id);
      throw new DriverError('vehicle_not_registered');
    }
    const presence = await this.deps.presence.online(id, {
      cityId: input.cityId,
      at: input.at,
      vehicle,
      tier: cap.tier,
      verticals,
    });
    return { roles, registered, gate, presence, cap };
  }

  async goOffline(actor: Actor): Promise<PartnerStatus> {
    await this.deps.presence.offline(actor.personId);
    return this.status(actor);
  }

  async currentOffer(actor: Actor): Promise<PartnerOffer | null> {
    const id = actor.personId;
    const presence = await this.deps.presence.get(id);
    const found = await this.deps.dispatch.openOffer(id, presence?.cityId ?? DEFAULT_CITY);
    if (!found) return null;
    const { offer, request } = found;
    const now = this.clock.now();
    const [trip, current] = await Promise.all([this.deps.trips.get(request.tripId), this.deps.trips.forDriver(id)]);
    const orders = await this.ordersOf(trip);
    const batchedSecond = current.some((t) => t.id !== trip.id);
    const pay = buildPay({
      vertical: request.vertical,
      orders,
      feeComponents: this.feeComponents(trip.cityId, request, orders[0]),
      batchedSecond,
      batchShare: this.deps.money.batchShare,
      compensationIqd: offer.compensationIqd,
      take: this.deps.money.take(request.vertical),
    });
    const dropStop = trip.stops.find((s) => s.type === 'dropoff');
    const names = await this.merchantNames(orders);
    const pickupLabel = orders[0]?.merchantOrgId ? (names.get(orders[0].merchantOrgId) ?? null) : null;
    const dropPin = dropStop?.target ?? null;
    const collect = orders.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.totalIqd + (o.debtCollectIqd ?? 0), 0);
    return {
      offerId: offer.id,
      tripId: trip.id,
      vertical: request.vertical,
      wave: offer.wave,
      sentAt: offer.sentAt,
      expiresAt: offer.expiresAt,
      ringSec: Math.max(1, Math.round((offer.expiresAt.getTime() - offer.sentAt.getTime()) / 1000)),
      seen: offer.seenAt !== null || offer.state === 'seen',
      // Spec: the offer names zones. Every driver in every wave sees it, so a person's door (the
      // dropoff, a ride's pickup) stays off it; the one who accepts gets the pins on `activeJob`.
      // o7: the public landmark each stop is near («يم باب الجامع الكبير») — a town place, never the door.
      pickup: { zoneId: request.zoneId, label: pickupLabel, pin: orders[0]?.merchantOrgId ? request.pickup : null, landmark: nearestLandmark(request.pickup) },
      dropoff: { zoneId: request.dropoffZoneId ?? dropStop?.zoneKey ?? request.zoneId, label: null, pin: null, landmark: nearestLandmark(dropPin) },
      distanceToPickupKm: offer.distanceKm ?? (presence ? kmBetween(presence, request.pickup) : null),
      tripKm: dropPin ? kmBetween(request.pickup, dropPin) : null,
      pay,
      batch: batchedSecond ? { extraIqd: pay.totalIqd, withTripIds: current.map((t) => t.id).filter((t) => t !== trip.id) } : null,
      merchant: this.prepOf(orders[0], now, names),
      collectIqd: collect > 0 ? collect : null,
      // Joy l9: the rider asked for him on this booked ride — the offer says so, and nothing more.
      favourite: offer.policy === FAVOURITE_OFFER_POLICY,
      // Ride step 3 (n4): the waiting rider nudged him — «راكب ينتظرك» and a soft chime on the card.
      nudgedAt: offer.nudgedAt ?? null,
      // Ride idea x5: «عنده غراض: قنينة غاز», before he accepts.
      rideCargo: cargoOf(orders),
      // c9/s3: booked for someone else — «المشوار لـ أم علي».
      rider: await this.riderOf(orders[0], id),
      // o12: «يوم حار · المكيّفة» on a car ride when x1 routes rides by AC (heating).
      climate: offerClimate(request.vertical, presence?.vehicle ?? null, now),
      // o10: how many rides the rider finished before («أول مشوار له» / «ركب 12 مشوار»); rides only.
      riderTrips: orders[0]?.type === 'ride' && this.deps.orders.riderTrips ? await this.deps.orders.riderTrips(orders[0].id) : null,
    };
  }

  /**
   * «مشاوير باچر» (edge-case review #28): rides booked for later he confirmed, and — while he is online —
   * the ones that fit him to confirm. Each says what an offer says: the time, the pickup and drop-off
   * zones, the trip km and his pay. Never a door or a name.
   */
  async bookedJobs(actor: Actor): Promise<PartnerBookedJobs> {
    const id = actor.personId;
    if (!this.deps.dispatch.bookedJobs) return { online: false, mine: [], open: [] };
    const presence = await this.deps.presence.get(id);
    const found = await this.deps.dispatch.bookedJobs(id, presence?.cityId ?? DEFAULT_CITY);
    const [mine, open] = await Promise.all([Promise.all(found.mine.map((r) => this.bookedView(r))), Promise.all(found.open.map((r) => this.bookedView(r)))]);
    return { online: found.online, mine, open };
  }

  async answerBookedJob(actor: Actor, input: AnswerBookedJobInput): Promise<PartnerBookedJobs> {
    if (!this.deps.dispatch.answerBookedJob) throw new DriverError('booked_job_not_found');
    await this.deps.dispatch.answerBookedJob(actor.personId, input.tripId, input.answer);
    return this.bookedJobs(actor);
  }

  private async bookedView(r: PartnerBookedRecord): Promise<PartnerBookedJob> {
    const trip = await this.deps.trips.get(r.request.tripId);
    const orders = await this.ordersOf(trip);
    const pay = buildPay({
      vertical: r.request.vertical,
      orders,
      feeComponents: [],
      batchedSecond: false,
      batchShare: this.deps.money.batchShare,
      compensationIqd: 0,
      take: this.deps.money.take(r.request.vertical),
    });
    const dropStop = trip.stops.find((s) => s.type === 'dropoff');
    const dropPin = dropStop?.target ?? null;
    const collect = orders.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.totalIqd + (o.debtCollectIqd ?? 0), 0);
    return {
      tripId: trip.id,
      vertical: r.request.vertical,
      scheduledFor: r.scheduledFor,
      state: r.held ? 'confirmed' : 'open',
      pickup: { zoneId: r.request.zoneId },
      dropoff: { zoneId: r.request.dropoffZoneId ?? dropStop?.zoneKey ?? r.request.zoneId },
      tripKm: dropPin ? kmBetween(r.request.pickup, dropPin) : null,
      pay,
      collectIqd: collect > 0 ? collect : null,
      favourite: r.favourite,
      confirmBy: r.confirmBy,
      startFrom: r.startFrom,
      showBy: r.showBy,
    };
  }

  async offerRoute(actor: Actor, input: PartnerOfferRouteInput): Promise<OrderRoute> {
    const now = this.clock.now();
    const none: OrderRoute = { polyline6: null, basis: 'estimated', from: null, computedAt: now };
    const presence = await this.deps.presence.get(actor.personId);
    const found = await this.deps.dispatch.openOffer(actor.personId, presence?.cityId ?? DEFAULT_CITY);
    if (!found || found.offer.id !== input.offerId || !presence || !this.deps.roads) return none;
    // Only a kitchen shapes an offer's road: a person's door stays off what every driver in the wave sees.
    const orders = await this.ordersOf(await this.deps.trips.get(found.request.tripId));
    if (!orders[0]?.merchantOrgId) return none;
    const from = { lat: presence.lat, lng: presence.lng };
    const r = await this.deps.roads.path([from, found.request.pickup]);
    return { polyline6: r.polyline6, basis: r.basis, from, computedAt: now };
  }

  async jobRoute(actor: Actor): Promise<OrderRoute> {
    const now = this.clock.now();
    const none: OrderRoute = { polyline6: null, basis: 'estimated', from: null, computedAt: now };
    const trip = await this.jobTrip(actor.personId);
    if (!trip || !this.deps.roads) return none;
    const ahead = [...trip.stops]
      .sort((a, b) => a.seq - b.seq)
      .filter((s) => s.state !== 'completed' && s.state !== 'skipped' && s.target)
      .map((s) => s.target!);
    const fix = await this.deps.trips.lastPosition?.(trip.id);
    const presence = fix && fix.driverId === actor.personId ? null : await this.deps.presence.get(actor.personId);
    const from = fix && fix.driverId === actor.personId ? fix.pin : presence ? { lat: presence.lat, lng: presence.lng } : null;
    if (!from || ahead.length === 0) return none;
    const r = await this.deps.roads.path([from, ...ahead]);
    return { polyline6: r.polyline6, basis: r.basis, from, computedAt: now };
  }

  async demandMap(actor: Actor): Promise<PartnerDemandMap> {
    const now = this.clock.now();
    const cityId = (await this.deps.presence.get(actor.personId))?.cityId ?? DEFAULT_CITY;
    const [waiting, drivers, expected] = await Promise.all([this.deps.dispatch.waitingZones(cityId), this.deps.presence.zones(cityId), this.expectedPickups(cityId, now)]);
    return { zones: demandZones(waiting, drivers, expected), at: now };
  }

  /**
   * The forecast (pickups this coming hour, same weekday, average of the last weeks), cached per city
   * for five minutes: every online driver reads the map each minute and history does not move.
   */
  private async expectedPickups(cityId: string, now: Date): Promise<Map<string, number>> {
    const bucket = Math.floor(now.getTime() / FORECAST_CACHE_MS);
    const hit = this.forecasts.get(cityId);
    if (hit && hit.bucket === bucket) return hit.byZone;
    const count = this.deps.trips.pickupsByZone;
    const byZone = new Map<string, number>();
    if (count) {
      for (const w of forecastWindows(now, DEMAND_MAP_RULES.weeks)) {
        for (const [zone, n] of await count(cityId, w.from, w.to)) byZone.set(zone, (byZone.get(zone) ?? 0) + n / DEMAND_MAP_RULES.weeks);
      }
    }
    this.forecasts.set(cityId, { bucket, byZone });
    return byZone;
  }

  /** The job on screen: the trip he accepted first (a batch shows its second order as more stops). */
  private async jobTrip(driverId: string): Promise<Trip | null> {
    const trips = await this.deps.trips.forDriver(driverId);
    return [...trips].sort((a, b) => (a.acceptedAt?.getTime() ?? 0) - (b.acceptedAt?.getTime() ?? 0))[0] ?? null;
  }

  async activeJob(actor: Actor): Promise<PartnerJob | null> {
    const trip = await this.jobTrip(actor.personId);
    if (!trip) return null;
    const now = this.clock.now();
    const orders = await this.ordersOf(trip);
    const names = await this.merchantNames(orders);
    const byId = new Map(orders.map((o) => [o.id, o]));
    const doors = await this.doorsOf(trip, actor.personId, now);
    const spots = await this.pickupSpotsOf(trip, byId, actor.personId, now);
    const codes = await this.startCodesOf(trip);
    const rideJob = trip.vertical === 'taxi' || trip.vertical === 'tuktuk';
    const riders = new Map(await Promise.all(orders.map(async (o) => [o.id, await this.riderOf(o, actor.personId)] as const)));
    const recipients = new Map(await Promise.all(orders.map(async (o) => [o.id, await this.recipientOf(o, actor.personId)] as const)));
    const stops: PartnerJobStop[] = [...trip.stops]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => {
        const order = s.orderId ? byId.get(s.orderId) : undefined;
        const isDrop = s.type === 'dropoff';
        return {
          stopId: s.id,
          seq: s.seq,
          type: s.type,
          state: s.state,
          zoneId: s.zoneKey,
          pin: s.target,
          label: s.type === 'pickup' && order?.merchantOrgId ? (names.get(order.merchantOrgId) ?? null) : null,
          orderId: s.orderId,
          // M-09: the courier reads the customer's note for him; an order placed with one note for
          // everyone (no courier note) keeps showing that one.
          note: isDrop ? (order?.courierNote ?? order?.note ?? null) : null,
          // M-3: the owed fees the order collects ride on the cash he takes (`owedFeesIqd` names them).
          collectIqd: isDrop && order?.paymentMethod === 'cash' ? order.totalIqd + (order.debtCollectIqd ?? 0) : 0,
          ...(isDrop && order?.paymentMethod === 'cash' && order.debtCollectIqd ? { owedFeesIqd: order.debtCollectIqd } : {}),
          // HUNT-02: «بالشارع» — the customer comes out to the street; he calls instead of going to the door.
          ...(isDrop && order?.streetHandover ? { streetHandover: true } : {}),
          // "الخردة علينا": the note the customer said he will pay with, so he brings the change.
          tenderIqd: isDrop && order?.paymentMethod === 'cash' ? (order.statedTenderIqd ?? null) : null,
          arrivedAt: s.arrivedAt,
          completedAt: s.completedAt,
          // Maps program r4: the code he shows at the counter, while the pickup is still to do. Rides have
          // no counter (and a second 4-digit number next to the night trip code would only confuse).
          pickupCode: s.type === 'pickup' && s.orderId && !rideJob && s.state !== 'completed' && s.state !== 'skipped' ? pickupCodeFor(s.orderId, trip.courierId ?? actor.personId) : null,
          door: doors.get(s.id) ?? null,
          pickupSpot: spots.get(s.id) ?? null,
          // «عزيمة» (joy g1): «هدية — لا تذكر السعر» at the door, no receipt in the bag at the kitchen.
          gift: order?.gift ?? null,
          // s1 «رمز المشوار»: only that one is needed before «الراكب صعد», never the code itself.
          ...(codes.has(s.id) ? { startCodeRequired: true } : {}),
          // c9/s3: the rider he picks up and drops off when the ride was booked for someone else.
          rider: s.orderId ? (riders.get(s.orderId) ?? null) : null,
          // SEC-14: whom he hands it to, on the drop-off, when someone else receives the order.
          recipient: isDrop && s.orderId ? (recipients.get(s.orderId) ?? null) : null,
          // j2: the public landmark it is near, for the headline and the spoken prompt.
          landmark: s.target ? nearestLandmark(s.target) : null,
        };
      });
    const request = { vertical: trip.vertical, zoneId: trip.stops.find((s) => s.type === 'pickup')?.zoneKey ?? '', dropoffZoneId: trip.stops.find((s) => s.type === 'dropoff')?.zoneKey ?? null };
    const pay = buildPay({
      vertical: trip.vertical,
      orders,
      feeComponents: this.feeComponents(trip.cityId, request, orders[0]),
      batchedSecond: false,
      batchShare: this.deps.money.batchShare,
      compensationIqd: 0,
      take: this.deps.money.take(trip.vertical),
    });
    return {
      tripId: trip.id,
      vertical: trip.vertical,
      state: trip.state,
      acceptedAt: trip.acceptedAt,
      stops,
      currentStopId: partnerCurrentStop(stops)?.stopId ?? null,
      unreachable: trip.unreachable,
      pay,
      merchant: this.prepOf(orders[0], now, names),
      rideCargo: cargoOf(orders),
    };
  }

  // ───────────────────────── helpers ─────────────────────────

  /** s1: the ride pickups still to do that need the rider's night code, by stop id. */
  private async startCodesOf(trip: Trip): Promise<ReadonlySet<string>> {
    const ask = this.deps.orders.startCodeRequired;
    const out = new Set<string>();
    if (!ask || (trip.vertical !== 'taxi' && trip.vertical !== 'tuktuk')) return out;
    for (const s of trip.stops) {
      if (s.type === 'pickup' && s.orderId && s.state !== 'completed' && s.state !== 'skipped' && (await ask(s.orderId))) out.add(s.id);
    }
    return out;
  }

  /** Doors of the job's drop-offs at customers' saved places (maps program f6, a5), by stop id. */
  private async doorsOf(trip: Trip, courierId: string, now: Date): Promise<Map<string, PartnerDoor>> {
    const doors = new Map<string, PartnerDoor>();
    const places = this.deps.places;
    if (!places) return doors;
    for (const s of trip.stops) {
      if (s.type !== 'dropoff' || !s.placeId) continue;
      const door = await places.courierDoor(s.placeId, { courierId, trip, now });
      if (!door) continue;
      doors.set(s.id, { ...door, firstVisit: (await places.dropoffsAt(s.placeId, trip.id)) === 0 });
    }
    return doors;
  }

  /**
   * The kitchen's pickup spot on each pickup still to do (maps program r7), by stop id. Once the food
   * is in his bag the photos have done their job, so a completed or skipped pickup shows none.
   */
  private async pickupSpotsOf(trip: Trip, orders: ReadonlyMap<string, Order>, courierId: string, now: Date): Promise<Map<string, PartnerPickupSpot>> {
    const out = new Map<string, PartnerPickupSpot>();
    const source = this.deps.pickupSpots;
    if (!source) return out;
    const byOrg = new Map<string, PartnerPickupSpot | null>();
    const input = { courierId, trip: { courierId: trip.courierId, acceptedAt: trip.acceptedAt, completedAt: trip.completedAt, cancelled: trip.cancelledAt !== null }, now };
    for (const s of trip.stops) {
      if (s.type !== 'pickup' || s.state === 'completed' || s.state === 'skipped' || !s.orderId) continue;
      const orgId = orders.get(s.orderId)?.merchantOrgId;
      if (!orgId) continue;
      if (!byOrg.has(orgId)) byOrg.set(orgId, await source.forCourier(orgId, input));
      const spot = byOrg.get(orgId);
      if (spot) out.set(s.id, spot);
    }
    return out;
  }

  private async demand(cityId: string, presence: PartnerPresence | null) {
    const [waiting, drivers] = await Promise.all([this.deps.dispatch.waitingZones(cityId), this.deps.presence.zones(cityId)]);
    return demandHint(waiting, drivers, presence?.zoneId ?? null);
  }

  /** c9/s3: the rider of a ride booked for someone else, by the name the booker gave; null otherwise. */
  private async riderOf(order: Order | undefined, driverId: string): Promise<{ name: string } | null> {
    if (order?.type !== 'ride' || !order.participants.some((p) => p.role === 'rider') || !this.deps.orders.riderName) return null;
    const name = await this.deps.orders.riderName(order.id, driverId);
    return name ? { name } : null;
  }

  /** SEC-14: the recipient of an order someone else receives, by the name the sender gave; null otherwise. */
  private async recipientOf(order: Order | undefined, driverId: string): Promise<{ name: string } | null> {
    if (!order?.participants.some((p) => p.role === 'recipient') || !this.deps.orders.recipientName) return null;
    const name = await this.deps.orders.recipientName(order.id, driverId);
    return name ? { name } : null;
  }

  /** Orders currently on the trip (detached ones are someone else's now). */
  private async ordersOf(trip: Trip): Promise<Order[]> {
    const ids = trip.orders.filter((o) => o.detachedAt === null).map((o) => o.orderId);
    const found = await Promise.all(ids.map((oid) => this.deps.orders.get(oid)));
    return found.filter((o): o is Order => o !== null);
  }

  /** The named parts of the delivery fee (night, rain, door…) from a fresh quote of the same zones. */
  private feeComponents(cityId: string, r: { vertical: Trip['vertical']; zoneId: string; dropoffZoneId: string | null }, order: Order | undefined): QuoteComponent[] {
    if (!order || order.type === 'ride' || !r.zoneId || !r.dropoffZoneId) return [];
    try {
      return this.deps.quotes.quote({ cityId, vertical: r.vertical, pickupZone: r.zoneId, dropoffZone: r.dropoffZoneId, at: order.placedAt })?.components ?? [];
    } catch {
      return [];
    }
  }

  private prepOf(order: Order | undefined, now: Date, names: ReadonlyMap<string, string | null>): PartnerMerchantPrep | null {
    if (!order?.merchantOrgId) return null;
    const name = names.get(order.merchantOrgId) ?? null;
    return name ? merchantPrep(name, order, now) : null;
  }

  /** Kitchen names of the job's orders (the orgs module reads them from its store). */
  private async merchantNames(orders: readonly Order[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(orders.map((o) => o.merchantOrgId).filter((id): id is string => !!id))];
    return new Map(await Promise.all(ids.map(async (id) => [id, await this.deps.merchants.name(id)] as const)));
  }
}
