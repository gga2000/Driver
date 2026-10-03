import { describe, expect, it } from 'vitest';
import type { DriverDocumentView, EarningsView } from '@driver/contracts';
import type { ConfigService } from '../config/index.js';
import type { DispatchService, LiveDriver } from '../dispatch/index.js';
import type { DriverAccountService } from '../driver-account/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { InMemoryFleetRepository } from './fleet.repository.js';
import { FleetService } from './fleet.service.js';

function earnings(driverId: string, netIqd: number, overCap = false): EarningsView {
  return {
    driverId,
    period: 'day',
    from: new Date(),
    to: new Date(),
    totals: { grossIqd: netIqd, takeIqd: 0, tipsIqd: 0, bonusesIqd: 0, guaranteeTopUpsIqd: 0, penaltiesIqd: 0, netIqd, jobs: 1 },
    jobs: [],
    cash: { collectedIqd: 0, toMerchantsIqd: 0, settledIqd: 0, heldIqd: 0, owedIqd: 5000 },
    cap: { role: 'driver', tier: 'silver', capIqd: 150000, owedIqd: 5000, remainingIqd: 145000, fill: 0.03, overCap, byTier: { bronze: 75000, silver: 150000, gold: 300000 } },
    payoutDueIqd: 0,
  };
}

async function setup() {
  const id = identityHarness('2026-10-03T09:00:00Z');
  const ev = createInMemoryEvents({ clock: id.clock });
  const owner = (await id.login('07700000001')).actor;
  await id.service.grantRole({ personId: 'admin' }, { personId: owner.personId, kind: 'fleet_owner', orgId: 'fleet_1' });
  const live: LiveDriver[] = [];
  const docs = new Map<string, DriverDocumentView[]>();
  const dispatch = { liveDrivers: async () => live } as unknown as DispatchService;
  const config = { cityIds: () => ['aziziyah'] } as unknown as ConfigService;
  const accounts = {
    earningsFor: async (driverId: string, period: 'day' | 'week') => earnings(driverId, period === 'day' ? 12500 : 80000),
    documentsOf: async (ids: readonly string[]) => new Map(ids.map((i) => [i, docs.get(i) ?? []])),
  } as unknown as DriverAccountService;
  const repo = new InMemoryFleetRepository();
  const fleet = new FleetService(repo, id.service, accounts, dispatch, config, ev.events, ev.uow, id.clock);
  return { id, ev, owner, live, docs, repo, fleet };
}

describe('fleet', () => {
  it('scopes every call to a fleet the caller owns', async () => {
    const h = await setup();
    const stranger = (await h.id.login('07700000002')).actor;
    await expect(h.fleet.vehicles(stranger, {})).rejects.toMatchObject({ code: 'fleet_not_found' });
    await expect(h.fleet.vehicles(h.owner, { fleetOrgId: 'fleet_2' })).rejects.toMatchObject({ code: 'forbidden' });
    await h.id.service.grantRole({ personId: 'admin' }, { personId: h.owner.personId, kind: 'fleet_owner', orgId: 'fleet_2' });
    await expect(h.fleet.vehicles(h.owner, {})).rejects.toMatchObject({ code: 'fleet_ambiguous' });
    expect(await h.fleet.vehicles(h.owner, { fleetOrgId: 'fleet_2' })).toEqual([]);
  });

  it('adds vehicles and drivers by phone, assigns one driver per vehicle, and builds the overview', async () => {
    const h = await setup();
    const v1 = await h.fleet.addVehicle(h.owner, { plate: 'واسط 12345', vehicleClass: 'car' });
    const v2 = await h.fleet.addVehicle(h.owner, { plate: 'واسط 777', vehicleClass: 'tuktuk' });
    await expect(h.fleet.addVehicle(h.owner, { plate: 'واسط  12345', vehicleClass: 'car' })).rejects.toMatchObject({ code: 'vehicle_plate_taken' });
    const d = await h.fleet.addDriver(h.owner, { phone: '07700000050' });
    expect(d).toMatchObject({ state: 'offline', vehicleId: null, todayEarningsIqd: 12500, weekEarningsIqd: 80000, tier: 'silver', phoneMasked: '+96477*****50' });
    // Names are read through the vault with the fleet purpose.
    expect(h.id.repo.accessLogs.some((l) => l.personId === d.driverId && l.purpose === 'fleet_view')).toBe(true);

    await h.fleet.assignDriver(h.owner, { vehicleId: v1.vehicleId, driverId: d.driverId });
    const moved = await h.fleet.assignDriver(h.owner, { vehicleId: v2.vehicleId, driverId: d.driverId });
    expect(moved.activeDriverId).toBe(d.driverId);
    expect((await h.fleet.vehicles(h.owner, {})).find((v) => v.vehicleId === v1.vehicleId)?.activeDriverId).toBeNull();
    await expect(h.fleet.assignDriver(h.owner, { vehicleId: v1.vehicleId, driverId: 'not_mine' })).rejects.toMatchObject({ code: 'driver_not_in_fleet' });

    h.live.push({ presence: { driverId: d.driverId } as LiveDriver['presence'], state: 'on_job', tripId: 't1' });
    h.docs.set(d.driverId, [
      { id: 'doc1', kind: 'licence', kind_ar: '', status: 'expiring', status_ar: '', expiresAt: new Date('2026-10-20T00:00:00Z'), daysToExpiry: 17, submittedAt: new Date(), reviewedAt: null, rejectReason: null },
      { id: 'doc2', kind: 'photo', kind_ar: '', status: 'approved', status_ar: '', expiresAt: null, daysToExpiry: null, submittedAt: new Date(), reviewedAt: null, rejectReason: null },
    ]);
    const o = await h.fleet.overview(h.owner, {});
    expect(o.totals).toMatchObject({ vehicles: 2, drivers: 1, online: 1, onJob: 1, todayEarningsIqd: 12500, weekEarningsIqd: 80000 });
    expect(o.drivers[0]).toMatchObject({ state: 'on_job', vehicleId: v2.vehicleId, documents: 'expiring' });
    expect(o.expiringDocuments).toEqual([{ driverId: d.driverId, kind: 'licence', status: 'expiring', expiresAt: new Date('2026-10-20T00:00:00Z'), daysToExpiry: 17 }]);
    expect((await h.ev.events.forActor(h.owner.personId)).map((e) => e.type)).toEqual(expect.arrayContaining(['fleet.vehicle_added', 'fleet.driver_added', 'fleet.vehicle_assigned']));
  });

  it("shows a fleet driver's earnings only to his fleet's owner", async () => {
    const h = await setup();
    const d = await h.fleet.addDriver(h.owner, { phone: '07700000050' });
    expect((await h.fleet.driverEarnings(h.owner, { driverId: d.driverId, period: 'week' })).driverId).toBe(d.driverId);
    await expect(h.fleet.driverEarnings(h.owner, { driverId: 'someone', period: 'week' })).rejects.toMatchObject({ code: 'driver_not_in_fleet' });
  });
});
