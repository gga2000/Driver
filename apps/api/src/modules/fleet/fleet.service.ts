import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type AddFleetDriverInput,
  type AddVehicleInput,
  type AssignDriverInput,
  type EarningsView,
  type FleetDriver,
  type FleetDriverEarningsInput,
  type FleetDriverState,
  type FleetOverview,
  type FleetPort,
  type FleetScopeInput,
  type FleetVehicle,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { ConfigService } from '../config/index.js';
import { DispatchService, type LiveDriver } from '../dispatch/index.js';
import { DriverAccountService, worstStatus } from '../driver-account/index.js';
import { EventsService } from '../events/index.js';
import { IdentityService } from '../identity/index.js';
import { FLEET_REPOSITORY, type FleetRepository, type VehicleRecord } from './fleet.repository.js';

function vehicleView(v: VehicleRecord): FleetVehicle {
  return { vehicleId: v.id, plate: v.plate, vehicleClass: v.vehicleClass, activeDriverId: v.activeDriverId, active: v.active };
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

  async vehicles(actor: Actor, input: FleetScopeInput): Promise<FleetVehicle[]> {
    return (await this.repo.vehicles(await this.fleetOf(actor, input.fleetOrgId))).map(vehicleView);
  }

  async drivers(actor: Actor, input: FleetScopeInput): Promise<FleetDriver[]> {
    return this.driverRows(actor, await this.fleetOf(actor, input.fleetOrgId));
  }

  private async driverRows(actor: Actor, fleetOrgId: string): Promise<FleetDriver[]> {
    const [links, vehicles] = await Promise.all([this.repo.drivers(fleetOrgId), this.repo.vehicles(fleetOrgId)]);
    const ids = links.map((l) => l.personId);
    if (ids.length === 0) return [];
    const now = this.clock.now();
    const live = new Map<string, LiveDriver>();
    for (const cityId of this.config.cityIds()) for (const d of await this.dispatch.liveDrivers(cityId, now)) live.set(d.presence.driverId, d);
    const [cards, docs] = await Promise.all([this.identity.memberCards(ids, actor.personId, 'fleet_view'), this.accounts.documentsOf(ids)]);
    const rows: FleetDriver[] = [];
    for (const id of ids) {
      const [today, week] = await Promise.all([this.accounts.earningsFor(id, 'day', now), this.accounts.earningsFor(id, 'week', now)]);
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
        documents: worstStatus((docs.get(id) ?? []).map((d) => d.status)),
      });
    }
    return rows;
  }

  async overview(actor: Actor, input: FleetScopeInput): Promise<FleetOverview> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const [vehicles, drivers] = await Promise.all([this.repo.vehicles(fleetOrgId), this.driverRows(actor, fleetOrgId)]);
    const docs = await this.accounts.documentsOf(drivers.map((d) => d.driverId));
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
    };
  }

  async driverEarnings(actor: Actor, input: FleetDriverEarningsInput): Promise<EarningsView> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    await this.assertMember(fleetOrgId, input.driverId);
    return this.accounts.earningsFor(input.driverId, input.period, input.anchor);
  }

  private async assertMember(fleetOrgId: string, driverId: string): Promise<void> {
    if (!(await this.repo.drivers(fleetOrgId)).some((d) => d.personId === driverId)) throw new DriverError('driver_not_in_fleet');
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
      const v = await this.repo.createVehicle({ plate, vehicleClass: input.vehicleClass, ownerOrgId: fleetOrgId }, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'fleet.vehicle_added', occurredAt: this.clock.now(), payload: { fleetOrgId, vehicleId: v.id, vehicleClass: v.vehicleClass } }, { name: 'org', id: fleetOrgId });
      return vehicleView(v);
    });
  }

  /** Links a driver by phone (the Person is found or created pseudonymously; the number stays in the vault). */
  async addDriver(actor: Actor, input: AddFleetDriverInput): Promise<FleetDriver> {
    const fleetOrgId = await this.fleetOf(actor, input.fleetOrgId);
    const personId = await this.identity.ensurePersonByPhone(input.phone, actor.personId, 'fleet_invite');
    await this.uow.run(async (tx) => {
      await this.repo.addDriver({ fleetOrgId, personId, addedById: actor.personId, at: this.clock.now() }, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'fleet.driver_added', occurredAt: this.clock.now(), payload: { fleetOrgId, personId } }, { name: 'org', id: fleetOrgId });
    });
    const row = (await this.driverRows(actor, fleetOrgId)).find((d) => d.driverId === personId);
    if (!row) throw new DriverError('internal');
    return row;
  }
}
