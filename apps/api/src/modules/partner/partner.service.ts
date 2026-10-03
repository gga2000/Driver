import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  PARTNER_DRIVING_ROLES,
  partnerCurrentStop,
  partnerModesOf,
  type Actor,
  type Order,
  type PartnerGoOnlineInput,
  type PartnerJob,
  type PartnerJobStop,
  type PartnerMerchantPrep,
  type PartnerOffer,
  type PartnerPort,
  type PartnerStatus,
  type QuoteComponent,
  type Trip,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { servedVerticals } from '../dispatch/index.js';
import { buildPay, demandHint, gateAllowsHeartbeat, gateErrorCode, kmBetween, merchantPrep, NEAR_CAP_SHARE, startOfLocalDay, todayFromLines } from './logic.js';
import { DEFAULT_CITY, PARTNER_DEPS, type PartnerDeps, type PartnerPresence } from './ports.js';

/**
 * `ctx.partner`: the Driver Partner app's own reads and presence. Composes dispatch (presence in
 * the geo index, the open offer, the board for demand), trips (the job), orders + orgs (pay, cash
 * to collect, the kitchen) and the ledger (cash vs cap, today's earnings). Owns no tables; every
 * read is the actor's own (authorization by role happens in the router).
 */
@Injectable()
export class PartnerService implements PartnerPort {
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
    const [offer, demand, gate] = await Promise.all([
      canDrive && presence ? this.deps.dispatch.openOffer(id, cityId) : Promise.resolve(null),
      canDrive ? this.demand(cityId, presence) : Promise.resolve(null),
      canDrive ? this.deps.gate.onlineGate(id) : Promise.resolve(null),
    ]);
    const heldIqd = Math.max(0, -cap.cashIqd);
    return {
      personId: id,
      roles,
      modes,
      primaryMode: modes[0] ?? null,
      canDrive,
      online: presence !== null,
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
    };
  }

  /**
   * Scoring §2: no daily check-in, a lock-out after two failed check-ins or an expired document keep
   * him offline. A refused call while he is online (the heartbeat) also takes him out of the index,
   * except for the check-in alone between local midnight and 04:00 (`gateAllowsHeartbeat`).
   */
  async goOnline(actor: Actor, input: PartnerGoOnlineInput): Promise<PartnerStatus> {
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
    await this.deps.presence.online(id, {
      cityId: input.cityId,
      at: input.at,
      vehicle,
      tier: cap.tier,
      verticals,
    });
    return this.status(actor);
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
    const collect = orders.filter((o) => o.paymentMethod === 'cash').reduce((s, o) => s + o.totalIqd, 0);
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
      pickup: { zoneId: request.zoneId, label: pickupLabel, pin: orders[0]?.merchantOrgId ? request.pickup : null },
      dropoff: { zoneId: request.dropoffZoneId ?? dropStop?.zoneKey ?? request.zoneId, label: null, pin: null },
      distanceToPickupKm: offer.distanceKm ?? (presence ? kmBetween(presence, request.pickup) : null),
      tripKm: dropPin ? kmBetween(request.pickup, dropPin) : null,
      pay,
      batch: batchedSecond ? { extraIqd: pay.totalIqd, withTripIds: current.map((t) => t.id).filter((t) => t !== trip.id) } : null,
      merchant: this.prepOf(orders[0], now, names),
      collectIqd: collect > 0 ? collect : null,
    };
  }

  async activeJob(actor: Actor): Promise<PartnerJob | null> {
    const trips = await this.deps.trips.forDriver(actor.personId);
    // The job on screen: the one he accepted first (a batch shows its second order as more stops).
    const trip = [...trips].sort((a, b) => (a.acceptedAt?.getTime() ?? 0) - (b.acceptedAt?.getTime() ?? 0))[0];
    if (!trip) return null;
    const now = this.clock.now();
    const orders = await this.ordersOf(trip);
    const names = await this.merchantNames(orders);
    const byId = new Map(orders.map((o) => [o.id, o]));
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
          note: isDrop ? (order?.note ?? null) : null,
          collectIqd: isDrop && order?.paymentMethod === 'cash' ? order.totalIqd : 0,
          arrivedAt: s.arrivedAt,
          completedAt: s.completedAt,
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
    };
  }

  // ───────────────────────── helpers ─────────────────────────

  private async demand(cityId: string, presence: PartnerPresence | null) {
    const [waiting, drivers] = await Promise.all([this.deps.dispatch.waitingZones(cityId), this.deps.presence.zones(cityId)]);
    return demandHint(waiting, drivers, presence?.zoneId ?? null);
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
