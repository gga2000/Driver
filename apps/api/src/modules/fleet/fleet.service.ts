import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type AddFleetDriverInput,
  type AddVehicleInput,
  type AssignDriverInput,
  type DriverDocumentView,
  type EarningsView,
  type FleetDay,
  type FleetDriver,
  type FleetDriverEarningsInput,
  type FleetDriverState,
  type FleetInvite,
  type FleetOverview,
  type FleetPort,
  type FleetScopeInput,
  type FleetVehicle,
  type RespondFleetInviteInput,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { localDateKey, startOfLocalWeek } from '../../shared/local-time.js';
import { ConfigService } from '../config/index.js';
import { DispatchService, type LiveDriver } from '../dispatch/index.js';
import { DriverAccountService, worstStatus } from '../driver-account/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService, invitePhoneHint, normalizeIraqiPhone } from '../identity/index.js';
import { OrgsService } from '../orgs/index.js';
import { FLEET_REPOSITORY, type FleetRepository, type VehicleRecord } from './fleet.repository.js';

function vehicleView(v: VehicleRecord): FleetVehicle {
  return { vehicleId: v.id, plate: v.plate, vehicleClass: v.vehicleClass, activeDriverId: v.activeDriverId, active: v.active, seats: v.seats };
}

const DAY_MS = 86_400_000;

/** The local week Sunday → Saturday with each day's job earnings summed over the fleet's drivers. */
export function fleetWeek(now: Date, jobs: ReadonlyArray<{ at: Date; netIqd: number }>): FleetDay[] {
  const start = startOfLocalWeek(now);
  const days: FleetDay[] = Array.from({ length: 7 }, (_, i) => ({ date: localDateKey(new Date(start.getTime() + i * DAY_MS + DAY_MS / 2)), earningsIqd: 0, jobs: 0 }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const j of jobs) {
    const d = byDate.get(localDateKey(j.at));
    if (!d) continue;
    d.earningsIqd += j.netIqd;
    d.jobs += 1;
  }
  return days;
}

function stateOf(live: LiveDriver | undefined, overCap: boolean): FleetDriverState {
  if (!live || live.state === 'offline_recent') return 'offline';
  if (live.state === 'on_job') return 'on_job';
  return overCap ? 'over_cap' : 'online';
}

/**
 * Fleet owner dashboard (partner spec). A fleet is an org; its owner holds `fleet_owner` scoped to
 * it. Vehicles are the `vehicles` registry (this module owns it); drivers are `fleet_drivers`. Live
 * state from dispatch, money from the driver-account module (ledger), names from the vault (logged).
 */
@Injectable()
export class FleetService implements FleetPort {
  constructor(
    @Inject(FLEET_REPOSITORY) private readonly repo: FleetRepository,
    private readonly identity: IdentityService,
    private readonly accounts: DriverAccountService,
    private readonly dispatch: DispatchService,
    private readonly config: ConfigService,
    private readonly events: EventsService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    /** Fleet names for the driver's invite card ("أسطول الربيعي"); absent in narrow tests. */
    @Optional() private readonly orgs?: OrgsService,
  ) {}

  /** The fleet the caller owns: the one named, or his only one. */
  async fleetOf(actor: Actor, fleetOrgId?: string): Promise<string> {
    const owned = (await this.identity.scopedOrgs(actor.personId, ['fleet_owner'])).map((o) => o.orgId);
    if (fleetOrgId) {
      if (!owned.includes(fleetOrgId)) throw new DriverError('forbidden');
      return fleetOrgId;
    }
    if (owned.length === 0) throw new DriverError('fleet_not_found');
    if (owned.length > 1) throw new DriverError('fleet_ambiguous');
    return owned[0]!;
  }

  /**
   * The vehicle a driver is the active driver of in the registry (any fleet), for `partner.goOnline`
   * (backend review 2026-10-04 #20: the vehicle comes from the registry, not the app). No actor
   * check: a narrow internal read of his own class and plate.
   */
  async activeVehicleOf(driverId: string): Promise<FleetVehicle | null> {
    const v = (await this.repo.activeVehicleOf?.(driverId)) ?? null;
    return v ? vehicleView(v) : null;
  }

  async vehicles(actor: Actor, input: FleetScopeInput): Promise<FleetVehicle[]> {
    return (await this.repo.vehicles(await this.fleetOf(actor, input.fleetOrgId))).map(vehicleView);
  }

  async drivers(actor: Actor, input: FleetScopeInput): Promise<FleetDriver[]> {
    return (await this.driverRows(actor, await this.fleetOf(actor, input.fleetOrgId))).rows;
  }

  private async driverRows(actor: Actor, fleetOrgId: string): Promise<{ rows: FleetDriver[]; weekJobs: Array<{ at: Date; netIqd: number }> }> {
    const [links, vehicles] = await Promise.all([this.repo.drivers(fleetOrgId), this.repo.vehicles(fleetOrgId)]);
    const weekJobs: Array<{ at: Date; netIqd: number }> = [];
    if (links.length === 0) return { rows: [], weekJobs };
    // Only drivers who accepted the fleet are read (vault, ledger, documents, presence); an invite
    // still pending shows as a bare id.
    const accepted = links.filter((l) => l.acceptedAt !== null);
    const joinedAt = new Map(accepted.map((l) => [l.personId, l.acceptedAt!]));
    const ids = accepted.map((l) => l.personId);
    const now = this.clock.now();
    const live = new Map<string, LiveDriver>();
    if (ids.length > 0) for (const cityId of this.config.cityIds()) for (const d of await this.dispatch.liveDrivers(cityId, now)) live.set(d.presence.driverId, d);
    const noCards: Record<string, { name: string | null; phoneMasked: string }> = {};
    const [cards, docs] =
      ids.length > 0
        ? await Promise.all([
            this.identity.memberCards(ids, actor.personId, 'fleet_view'),
            this.accounts.documentsOf(ids),
          ])
        : [noCards, new Map<string, DriverDocumentView[]>()];
    // Pending: only the number the owner typed, as "0770 ••• 4567", kept on his own invite event —
    // no vault read for someone who has not said yes.
    const hints = links.some((l) => l.acceptedAt === null)
      ? await this.inviteHints(fleetOrgId)
      : new Map<string, string>();
    const rows: FleetDriver[] = [];
    for (const link of links) {
      if (link.acceptedAt === null) {
        rows.push({
          ...pendingRow(link.personId),
          phoneHint: hints.get(link.personId) ?? null,
          invitedAt: link.createdAt,
        });
        continue;
      }
      const id = link.personId;
      const notBefore = joinedAt.get(id);
      const [today, week] = await Promise.all([this.accounts.earningsFor(id, 'day', now, { notBefore }), this.accounts.earningsFor(id, 'week', now, { notBefore })]);
      for (const j of week.jobs) weekJobs.push({ at: j.at, netIqd: j.netIqd });
      rows.push({
        driverId: id,
        name: cards[id]?.name ?? null,
        phoneMasked: cards[id]?.phoneMasked ?? null,
        state: stateOf(live.get(id), today.cap.overCap),
        vehicleId: vehicles.find((v) => v.activeDriverId === id)?.id ?? null,
        tier: today.cap.tier,
        todayEarningsIqd: today.totals.netIqd,
        weekEarningsIqd: week.totals.netIqd,
        owedIqd: today.cash.owedIqd,
        cashHeldIqd: today.cash.heldIqd,
        capIqd: today.cap.capIqd,
        documents: worstStatus((docs.get(id) ?? []).map((d) => d.status)),
        pending: false,
      });
    }
    return { rows, weekJobs };
  }

  /** The phone hint each invite was sent with (`fleet.driver_added.phoneHint`), latest per person. */
  private async inviteHints(fleetOrgId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const e of await this.events.forAggregate('org', fleetOrgId)) {
      if (e.type !== 'fleet.driver_added') continue;
      const p = e.payload as { personId?: unknown; phoneHint?: unknown };
      if (typeof p.personId === 'string' && typeof p.phoneHint === 'string')
        out.set(p.personId, p.phoneHint);
    }
    return out;
  }

  async overview(actor: Actor, input: FleetScopeInput): Promise<FleetOverview> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const [vehicles, { rows: drivers, weekJobs }] = await Promise.all([this.repo.vehicles(fleetOrgId), this.driverRows(actor, fleetOrgId)]);
    const docs = await this.accounts.documentsOf(drivers.filter((d) => !d.pending).map((d) => d.driverId));
    const expiring = [...docs.entries()]
      .flatMap(([driverId, list]) => list.filter((d) => d.status === 'expired' || d.status === 'expiring').map((d) => ({ driverId, kind: d.kind, status: d.status, expiresAt: d.expiresAt, daysToExpiry: d.daysToExpiry })))
      .sort((a, b) => (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0));
    return {
      fleetOrgId,
      totals: {
        vehicles: vehicles.length,
        drivers: drivers.length,
        online: drivers.filter((d) => d.state !== 'offline').length,
        onJob: drivers.filter((d) => d.state === 'on_job').length,
        todayEarningsIqd: drivers.reduce((s, d) => s + d.todayEarningsIqd, 0),
        weekEarningsIqd: drivers.reduce((s, d) => s + d.weekEarningsIqd, 0),
        owedIqd: drivers.reduce((s, d) => s + d.owedIqd, 0),
      },
      vehicles: vehicles.map(vehicleView),
      drivers,
      expiringDocuments: expiring,
      days: fleetWeek(this.clock.now(), weekJobs),
    };
  }

  async driverEarnings(actor: Actor, input: FleetDriverEarningsInput): Promise<EarningsView> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const joinedAt = await this.assertMember(fleetOrgId, input.driverId);
    return this.accounts.earningsFor(input.driverId, input.period, input.anchor, { notBefore: joinedAt });
  }

  /** The driver accepted this fleet (a pending invite is not membership); returns when he joined. */
  private async assertMember(fleetOrgId: string, driverId: string): Promise<Date> {
    const link = (await this.repo.drivers(fleetOrgId)).find((d) => d.personId === driverId);
    if (!link?.acceptedAt) throw new DriverError('driver_not_in_fleet');
    return link.acceptedAt;
  }

  async assignDriver(actor: Actor, input: AssignDriverInput): Promise<FleetVehicle> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const vehicle = await this.repo.vehicle(input.vehicleId);
    if (!vehicle || vehicle.ownerOrgId !== fleetOrgId) throw new DriverError('vehicle_not_found');
    if (input.driverId) await this.assertMember(fleetOrgId, input.driverId);
    return this.uow.run(async (tx) => {
      const updated = await this.repo.setActiveDriver(vehicle.id, input.driverId, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'fleet.vehicle_assigned', occurredAt: this.clock.now(), payload: { fleetOrgId, vehicleId: vehicle.id, driverId: input.driverId, previousDriverId: vehicle.activeDriverId } },
        { name: 'org', id: fleetOrgId },
      );
      return vehicleView(updated);
    });
  }

  async addVehicle(actor: Actor, input: AddVehicleInput): Promise<FleetVehicle> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const plate = input.plate.replace(/\s+/g, ' ').trim();
    if (await this.repo.vehicleByPlate(plate)) throw new DriverError('vehicle_plate_taken');
    return this.uow.run(async (tx) => {
      const v = await this.repo.createVehicle({ plate, vehicleClass: input.vehicleClass, ownerOrgId: fleetOrgId, ...(input.seats !== undefined ? { seats: input.seats } : {}) }, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'fleet.vehicle_added', occurredAt: this.clock.now(), payload: { fleetOrgId, vehicleId: v.id, vehicleClass: v.vehicleClass } }, { name: 'org', id: fleetOrgId });
      return vehicleView(v);
    });
  }

  /**
   * Invites a driver by phone (the Person is found or created pseudonymously; the number stays in the
   * vault). The link is pending until the driver accepts (`respondInvite`): typing a number must not
   * reveal whose it is, nor his money (review 2026-10-04 #2).
   */
  async addDriver(actor: Actor, input: AddFleetDriverInput): Promise<FleetDriver> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const personId = await this.identity.ensurePersonByPhone(input.phone, actor.personId, 'fleet_invite');
    await this.uow.run(async (tx) => {
      const link = await this.repo.addDriver({ fleetOrgId, personId, addedById: actor.personId, at: this.clock.now() }, tx);
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: 'fleet.driver_added',
          occurredAt: this.clock.now(),
          payload: {
            fleetOrgId,
            personId,
            pending: link.acceptedAt === null,
            phoneHint: invitePhoneHint(normalizeIraqiPhone(input.phone)),
          },
        },
        { name: 'org', id: fleetOrgId },
      );
    });
    const row = (await this.driverRows(actor, fleetOrgId)).rows.find((d) => d.driverId === personId);
    if (!row) throw new DriverError('internal');
    return row;
  }

  // ───────────────────────── driver side ─────────────────────────

  async myInvites(actor: Actor): Promise<FleetInvite[]> {
    const links = await this.repo.linksOf(actor.personId);
    const owners = [...new Set(links.map((l) => l.addedById))];
    const names =
      owners.length > 0
        ? await this.identity.firstNamesFor(owners, actor.personId, 'fleet_invite')
        : {};
    const fleetNames = new Map<string, string | null>();
    for (const id of new Set(links.map((l) => l.fleetOrgId)))
      fleetNames.set(id, (await this.orgs?.find(id))?.name ?? null);
    return links.map((l) => ({
      fleetOrgId: l.fleetOrgId,
      invitedAt: l.createdAt,
      invitedByName: names[l.addedById] ?? null,
      fleetName: fleetNames.get(l.fleetOrgId) ?? null,
      accepted: l.acceptedAt !== null,
    }));
  }

  /** The driver accepts a fleet's invite, or declines it / leaves the fleet (his vehicle there is freed). */
  async respondInvite(actor: Actor, input: RespondFleetInviteInput): Promise<FleetInvite[]> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const link = await this.repo.answerLink({ fleetOrgId: input.fleetOrgId, personId: actor.personId, accept: input.accept, at: now }, tx);
      if (!link) throw new DriverError('fleet_not_found');
      if (!input.accept) {
        for (const v of await this.repo.vehicles(input.fleetOrgId, tx)) if (v.activeDriverId === actor.personId) await this.repo.setActiveDriver(v.id, null, tx);
      }
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: input.accept ? 'fleet.driver_accepted' : 'fleet.driver_left', occurredAt: now, payload: { fleetOrgId: input.fleetOrgId, personId: actor.personId } },
        { name: 'org', id: input.fleetOrgId },
      );
    });
    return this.myInvites(actor);
  }
}

/** An invite the driver has not accepted: nothing about him but the id. */
function pendingRow(driverId: string): FleetDriver {
  return {
    driverId,
    name: null,
    phoneMasked: null,
    state: 'offline',
    vehicleId: null,
    tier: 'bronze',
    todayEarningsIqd: 0,
    weekEarningsIqd: 0,
    owedIqd: 0,
    cashHeldIqd: 0,
    capIqd: 0,
    documents: null,
    pending: true,
  };
}
