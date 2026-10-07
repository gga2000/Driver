import { describe, expect, it } from 'vitest';
import type { DriverDocumentView, EarningsView } from '@driver/contracts';
import type { ConfigService } from '../config/index.js';
import type { DispatchService, LiveDriver } from '../dispatch/index.js';
import type { DriverAccountService } from '../driver-account/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { OrgsService } from '../orgs/index.js';
import { checkFeatures, claimFeatures, InMemoryFleetRepository, unconfirmedFeatures } from './fleet.repository.js';
import { FleetService, fleetWeek } from './fleet.service.js';

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
    const invited = await h.fleet.addDriver(h.owner, { phone: '07700000050' });
    expect(invited).toMatchObject({ pending: true, name: null, todayEarningsIqd: 0 });
    // The driver accepts in his Partner app; from then on the owner sees him.
    await h.fleet.respondInvite((await h.id.login('07700000050')).actor, { fleetOrgId: 'fleet_1', accept: true });
    const d = (await h.fleet.drivers(h.owner, {})).find((x) => x.driverId === invited.driverId)!;
    expect(d).toMatchObject({ pending: false, state: 'offline', vehicleId: null, todayEarningsIqd: 12500, weekEarningsIqd: 80000, tier: 'silver', phoneMasked: '+96477*****50', cashHeldIqd: 0, capIqd: 150000 });
    expect([v1.seats, v2.seats]).toEqual([4, 3]);
    expect((await h.fleet.addVehicle(h.owner, { plate: 'واسط 999', vehicleClass: 'van', seats: 11 })).seats).toBe(11);
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
    expect(o.days).toHaveLength(7);
    expect(o.totals).toMatchObject({ vehicles: 3, drivers: 1, online: 1, onJob: 1, todayEarningsIqd: 12500, weekEarningsIqd: 80000 });
    expect(o.drivers[0]).toMatchObject({ state: 'on_job', vehicleId: v2.vehicleId, documents: 'expiring' });
    expect(o.expiringDocuments).toEqual([{ driverId: d.driverId, kind: 'licence', status: 'expiring', expiresAt: new Date('2026-10-20T00:00:00Z'), daysToExpiry: 17 }]);
    expect((await h.ev.events.forActor(h.owner.personId)).map((e) => e.type)).toEqual(expect.arrayContaining(['fleet.vehicle_added', 'fleet.driver_added', 'fleet.vehicle_assigned']));
  });

  it("shows a fleet driver's earnings only to his fleet's owner", async () => {
    const h = await setup();
    const d = await h.fleet.addDriver(h.owner, { phone: '07700000050' });
    await h.fleet.respondInvite((await h.id.login('07700000050')).actor, { fleetOrgId: 'fleet_1', accept: true });
    expect((await h.fleet.driverEarnings(h.owner, { driverId: d.driverId, period: 'week' })).driverId).toBe(d.driverId);
    await expect(h.fleet.driverEarnings(h.owner, { driverId: 'someone', period: 'week' })).rejects.toMatchObject({ code: 'driver_not_in_fleet' });
  });
});

describe('invite with a car (partner redesign f5)', () => {
  it('the car picked with the invite waits on it, shows on both sides, and becomes his when he accepts', async () => {
    const h = await setup();
    const car = await h.fleet.addVehicle(h.owner, { plate: 'واسط 4410', vehicleClass: 'car', model: 'Toyota Corolla', colour: 'white' });
    await expect(h.fleet.addDriver(h.owner, { phone: '07700000070', vehicleId: 'not_ours' })).rejects.toMatchObject({ code: 'vehicle_not_found' });
    const invited = await h.fleet.addDriver(h.owner, { phone: '07700000070', vehicleId: car.vehicleId });
    expect(invited).toMatchObject({ pending: true, vehicleId: null, plannedVehicleId: car.vehicleId });
    const driver = (await h.id.login('07700000070')).actor;
    expect((await h.fleet.myInvites(driver))[0]!.plannedVehicle).toEqual({ plate: 'واسط 4410', vehicleClass: 'car', model: 'Toyota Corolla', colour: 'white' });
    // Nothing is assigned before his yes.
    expect((await h.fleet.vehicles(h.owner, {}))[0]!.activeDriverId).toBeNull();
    await h.fleet.respondInvite(driver, { fleetOrgId: 'fleet_1', accept: true });
    expect((await h.fleet.vehicles(h.owner, {}))[0]!.activeDriverId).toBe(driver.personId);
    expect((await h.fleet.drivers(h.owner, {}))[0]).toMatchObject({ pending: false, vehicleId: car.vehicleId });
    expect((await h.fleet.myInvites(driver))[0]!.plannedVehicle).toBeNull();
    expect((await h.ev.events.forActor(driver.personId)).map((e) => e.type)).toEqual(expect.arrayContaining(['fleet.driver_accepted', 'fleet.vehicle_assigned']));
  });

  it('a car someone else drives by then is left alone; a declined invite assigns nothing', async () => {
    const h = await setup();
    const car = await h.fleet.addVehicle(h.owner, { plate: 'واسط 4411', vehicleClass: 'car' });
    await h.fleet.addDriver(h.owner, { phone: '07700000071', vehicleId: car.vehicleId });
    await h.fleet.addDriver(h.owner, { phone: '07700000072', vehicleId: car.vehicleId });
    const first = (await h.id.login('07700000071')).actor;
    const second = (await h.id.login('07700000072')).actor;
    await h.fleet.respondInvite(first, { fleetOrgId: 'fleet_1', accept: true });
    await h.fleet.respondInvite(second, { fleetOrgId: 'fleet_1', accept: true });
    expect((await h.fleet.vehicles(h.owner, {}))[0]!.activeDriverId).toBe(first.personId);

    const other = await h.fleet.addVehicle(h.owner, { plate: 'واسط 4412', vehicleClass: 'car' });
    await h.fleet.addDriver(h.owner, { phone: '07700000073', vehicleId: other.vehicleId });
    await h.fleet.respondInvite((await h.id.login('07700000073')).actor, { fleetOrgId: 'fleet_1', accept: false });
    expect((await h.fleet.vehicles(h.owner, {})).find((v) => v.vehicleId === other.vehicleId)!.activeDriverId).toBeNull();
  });
});

describe('fleet consent (review 2026-10-04 #2)', () => {
  it("the driver's invite card names the owner (first name) and the fleet", async () => {
    const h = await setup();
    const orgs = new OrgsService(undefined, h.id.clock);
    const org = await orgs.create({
      type: 'fleet',
      name: 'أسطول الربيعي',
      cityId: 'aziziyah',
      ownerId: h.owner.personId,
    });
    await h.id.service.grantRole(
      { personId: 'admin' },
      { personId: h.owner.personId, kind: 'fleet_owner', orgId: org.id },
    );
    await h.id.service.updateProfile(h.owner, { name: 'سجاد الربيعي' });
    const fleet = new FleetService(
      h.repo,
      h.id.service,
      {
        earningsFor: async () => earnings('x', 0),
        documentsOf: async () => new Map(),
      } as unknown as DriverAccountService,
      { liveDrivers: async () => [] } as unknown as DispatchService,
      { cityIds: () => ['aziziyah'] } as unknown as ConfigService,
      h.ev.events,
      h.ev.uow,
      h.id.clock,
      orgs,
    );
    await fleet.addDriver(h.owner, { fleetOrgId: org.id, phone: '07700000061' });
    const driver = (await h.id.login('07700000061')).actor;
    expect(await fleet.myInvites(driver)).toEqual([
      {
        fleetOrgId: org.id,
        invitedAt: expect.any(Date),
        invitedByName: 'سجاد',
        fleetName: 'أسطول الربيعي',
        accepted: false,
        plannedVehicle: null,
      },
    ]);
  });

  it("adding a phone shows nothing of that person until he accepts the fleet's invite", async () => {
    const h = await setup();
    // An independent courier with a name in the vault and money on his book.
    const courier = (await h.id.login('07700000060')).actor;
    await h.id.service.updateProfile(courier, { name: 'حيدر كاظم جواد' });
    const before = h.id.repo.accessLogs.filter((l) => l.personId === courier.personId).length;
    const row = await h.fleet.addDriver(h.owner, { phone: '07700000060' });
    expect(row).toMatchObject({
      driverId: courier.personId,
      pending: true,
      name: null,
      phoneMasked: null,
      todayEarningsIqd: 0,
      weekEarningsIqd: 0,
      owedIqd: 0,
      cashHeldIqd: 0,
      documents: null,
    });
    // Only the number he typed, as he typed it (head and tail), from his own invite: "بانتظار موافقة السايق".
    expect(row).toMatchObject({ phoneHint: '0770 ••• 0060', invitedAt: h.id.clock.now() });
    expect(JSON.stringify(await h.fleet.overview(h.owner, {}))).not.toContain('حيدر');
    expect((await h.fleet.overview(h.owner, {})).totals).toMatchObject({ drivers: 1, todayEarningsIqd: 0, weekEarningsIqd: 0 });
    // No vault read of his name or phone on the owner's behalf.
    expect(h.id.repo.accessLogs.filter((l) => l.personId === courier.personId)).toHaveLength(before);
    await expect(h.fleet.driverEarnings(h.owner, { driverId: courier.personId, period: 'week' })).rejects.toMatchObject({ code: 'driver_not_in_fleet' });
    const v = await h.fleet.addVehicle(h.owner, { plate: 'واسط 4040', vehicleClass: 'car' });
    await expect(h.fleet.assignDriver(h.owner, { vehicleId: v.vehicleId, driverId: courier.personId })).rejects.toMatchObject({ code: 'driver_not_in_fleet' });

    // He sees the invite in his app and accepts it: from then on the owner sees him.
    const invites = await h.fleet.myInvites(courier);
    expect(invites).toEqual([
      {
        fleetOrgId: 'fleet_1',
        invitedAt: expect.any(Date),
        invitedByName: null,
        fleetName: null,
        accepted: false,
        plannedVehicle: null,
      },
    ]);
    await h.fleet.respondInvite(courier, { fleetOrgId: 'fleet_1', accept: true });
    const after = (await h.fleet.drivers(h.owner, {}))[0]!;
    expect(after).toMatchObject({ pending: false, name: 'حيدر كاظم جواد', todayEarningsIqd: 12500 });
    expect((await h.fleet.driverEarnings(h.owner, { driverId: courier.personId, period: 'week' })).driverId).toBe(courier.personId);

    // Leaving the fleet hides him again and frees the vehicle.
    await h.fleet.assignDriver(h.owner, { vehicleId: v.vehicleId, driverId: courier.personId });
    await h.fleet.respondInvite(courier, { fleetOrgId: 'fleet_1', accept: false });
    expect(await h.fleet.drivers(h.owner, {})).toEqual([]);
    expect((await h.fleet.vehicles(h.owner, {}))[0]!.activeDriverId).toBeNull();
    await expect(h.fleet.respondInvite(courier, { fleetOrgId: 'fleet_9', accept: true })).rejects.toMatchObject({ code: 'fleet_not_found' });
  });

  it("an accepted driver's earnings start at the day he joined", async () => {
    const h = await setup();
    const calls: Array<{ notBefore: Date | undefined }> = [];
    const fleet = new FleetService(
      h.repo,
      h.id.service,
      {
        earningsFor: async (driverId: string, period: 'day' | 'week', _anchor?: Date, opts?: { notBefore?: Date }) => {
          calls.push({ notBefore: opts?.notBefore });
          return earnings(driverId, period === 'day' ? 1 : 2);
        },
        documentsOf: async (ids: readonly string[]) => new Map(ids.map((i) => [i, []])),
      } as unknown as DriverAccountService,
      { liveDrivers: async () => [] } as unknown as DispatchService,
      { cityIds: () => ['aziziyah'] } as unknown as ConfigService,
      h.ev.events,
      h.ev.uow,
      h.id.clock,
    );
    const courier = (await h.id.login('07700000061')).actor;
    await fleet.addDriver(h.owner, { phone: '07700000061' });
    h.id.clock.advance(60_000);
    await fleet.respondInvite(courier, { fleetOrgId: 'fleet_1', accept: true });
    calls.length = 0;
    await fleet.driverEarnings(h.owner, { driverId: courier.personId, period: 'month' });
    expect(calls.map((c) => c.notBefore)).toEqual([h.id.clock.now()]);
  });
});

describe('fleetWeek', () => {
  it('buckets job earnings into the local week, Sunday to Saturday', () => {
    // Saturday 2026-10-03 12:00 local; the week started Sunday 2026-09-27.
    const now = new Date('2026-10-03T09:00:00Z');
    const days = fleetWeek(now, [
      { at: new Date('2026-09-27T05:00:00Z'), netIqd: 3000 },
      { at: new Date('2026-09-27T22:30:00Z'), netIqd: 2000 }, // 01:30 Monday local
      { at: new Date('2026-10-03T08:00:00Z'), netIqd: 1500 },
      { at: new Date('2026-09-26T08:00:00Z'), netIqd: 9999 }, // last week
    ]);
    expect(days.map((d) => d.date)).toEqual(['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(days.map((d) => d.earningsIqd)).toEqual([3000, 2000, 0, 0, 0, 0, 1500]);
    expect(days.map((d) => d.jobs)).toEqual([1, 1, 0, 0, 0, 0, 1]);
  });
});

describe('vehicle details and features (ride step 3: d1, n1, n2)', () => {
  /** A fleet car with a driver who accepted the fleet and drives it, and a field ops reviewer. */
  async function carWithDriver() {
    const h = await setup();
    const car = await h.fleet.addVehicle(h.owner, { plate: 'واسط 31207', vehicleClass: 'car', model: '  Toyota   Corolla ', colour: 'white' });
    const driver = (await h.id.login('07700000060')).actor;
    await h.fleet.addDriver(h.owner, { phone: '07700000060' });
    await h.fleet.respondInvite(driver, { fleetOrgId: 'fleet_1', accept: true });
    await h.fleet.assignDriver(h.owner, { vehicleId: car.vehicleId, driverId: driver.personId });
    const ops = (await h.id.login('07700000070')).actor;
    await h.id.service.grantRole({ personId: 'admin' }, { personId: ops.personId, kind: 'field_ops' });
    return { h, car, driver, ops };
  }

  it('the fleet owner registers the model and colour; a new car claims nothing', async () => {
    const { car } = await carWithDriver();
    expect(car).toMatchObject({ model: 'Toyota Corolla', colour: 'white', features: [], featuresConfirmed: [] });
  });

  it('the driver claims features on the car he drives, in display order; no car, no claims', async () => {
    const { h, car, driver } = await carWithDriver();
    const walker = (await h.id.login('07700000061')).actor;
    expect(await h.fleet.myVehicle(walker)).toBeNull();
    await expect(h.fleet.setMyVehicleFeatures(walker, { features: ['ac'] })).rejects.toMatchObject({ code: 'vehicle_not_found' });
    const claimed = await h.fleet.setMyVehicleFeatures(driver, { features: ['family', 'ac', 'family'] });
    expect(claimed).toMatchObject({ vehicleId: car.vehicleId, features: ['ac', 'family'], featuresConfirmed: [] });
    expect(await h.fleet.myVehicle(driver)).toMatchObject({ features: ['ac', 'family'] });
    expect((await h.ev.events.forAggregate('vehicle', car.vehicleId)).map((e) => [e.type, e.payload])).toEqual([['fleet.vehicle_features_claimed', { vehicleId: car.vehicleId, added: ['ac', 'family'], removed: [] }]]);
  });

  it('a tuktuk offers no AC, heating or boot (`CLASS_FEATURES`)', async () => {
    const { h, driver } = await carWithDriver();
    const tuktuk = await h.fleet.addVehicle(h.owner, { plate: 'واسط 8841', vehicleClass: 'tuktuk', model: 'باجاج', colour: 'red' });
    await h.fleet.assignDriver(h.owner, { vehicleId: tuktuk.vehicleId, driverId: driver.personId });
    await expect(h.fleet.setMyVehicleFeatures(driver, { features: ['ac', 'family'] })).rejects.toMatchObject({ code: 'vehicle_feature_not_offered' });
    expect(await h.fleet.setMyVehicleFeatures(driver, { features: ['no_smoking', 'family'] })).toMatchObject({ vehicleId: tuktuk.vehicleId, features: ['family', 'no_smoking'] });
  });

  it('approving a new fleet car is its car check: what ops saw is confirmed, the rest is cleared', async () => {
    const { h, car, driver, ops } = await carWithDriver();
    await h.fleet.setMyVehicleFeatures(driver, { features: ['ac', 'family'] });
    // Still pending: its claims wait for the vehicle check itself, not the features queue.
    expect(await h.fleet.vehiclesWithUnconfirmedFeatures()).toEqual([]);
    const checked = await h.fleet.reviewVehicle(ops, { vehicleId: car.vehicleId, approve: true, confirmFeatures: ['ac'] });
    expect(checked).toMatchObject({ reviewState: 'verified', features: ['ac'], featuresConfirmed: ['ac'] });
  });

  it('later claims wait for the car check; taking one off drops its confirmation at once', async () => {
    const { h, car, driver, ops } = await carWithDriver();
    await h.fleet.reviewVehicle(ops, { vehicleId: car.vehicleId, approve: true });
    await h.fleet.setMyVehicleFeatures(driver, { features: ['ac'] });
    expect((await h.fleet.vehiclesWithUnconfirmedFeatures()).map((v) => v.id)).toEqual([car.vehicleId]);
    await h.fleet.reviewFeatures(ops, { vehicleId: car.vehicleId, approve: true });
    expect(await h.fleet.myVehicle(driver)).toMatchObject({ features: ['ac'], featuresConfirmed: ['ac'] });
    expect(await h.fleet.vehiclesWithUnconfirmedFeatures()).toEqual([]);
    // He adds heating (it waits) and takes AC off (riders stop seeing it now, not after a check).
    expect(await h.fleet.setMyVehicleFeatures(driver, { features: ['heating'] })).toMatchObject({ features: ['heating'], featuresConfirmed: [] });
    expect((await h.fleet.vehiclesWithUnconfirmedFeatures()).map((v) => v.id)).toEqual([car.vehicleId]);
  });

  it("the features check: nobody checks his own car or his fleet's; a reject clears what was waiting", async () => {
    const { h, car, driver, ops } = await carWithDriver();
    await h.fleet.reviewVehicle(ops, { vehicleId: car.vehicleId, approve: true, confirmFeatures: [] });
    await h.fleet.setMyVehicleFeatures(driver, { features: ['ac'] });
    await h.fleet.reviewFeatures(ops, { vehicleId: car.vehicleId, approve: true });
    await h.fleet.setMyVehicleFeatures(driver, { features: ['ac', 'heating', 'big_boot'] });
    await h.id.service.grantRole({ personId: 'admin' }, { personId: driver.personId, kind: 'field_ops' });
    await expect(h.fleet.reviewFeatures(driver, { vehicleId: car.vehicleId, approve: true })).rejects.toMatchObject({ code: 'approval_own_item' });
    await expect(h.fleet.reviewFeatures(h.owner, { vehicleId: car.vehicleId, approve: true })).rejects.toMatchObject({ code: 'approval_own_item' });
    const rejected = await h.fleet.reviewFeatures(ops, { vehicleId: car.vehicleId, approve: false, reason: 'الهيتر ما يشتغل' });
    expect(rejected).toMatchObject({ features: ['ac'], featuresConfirmed: ['ac'] });
    await expect(h.fleet.reviewFeatures(ops, { vehicleId: car.vehicleId, approve: true })).rejects.toMatchObject({ code: 'approval_state_conflict' });
    const checks = (await h.ev.events.forAggregate('vehicle', car.vehicleId)).filter((e) => e.type === 'fleet.vehicle_features_checked');
    expect(checks.at(-1)?.payload).toMatchObject({ confirmed: ['ac'], cleared: ['heating', 'big_boot'], reason: 'الهيتر ما يشتغل' });
  });
});

describe('claimFeatures / checkFeatures', () => {
  it('a claim keeps its confirmation only while claimed; the check confirms what it saw of the claims', () => {
    expect(claimFeatures({ featuresConfirmed: ['ac', 'family'] }, ['family', 'heating'])).toEqual({ features: ['heating', 'family'], featuresConfirmed: ['family'] });
    expect(checkFeatures({ features: ['ac', 'family'] }, ['family', 'child_seat'])).toEqual({ features: ['family'], featuresConfirmed: ['family'] });
    expect(unconfirmedFeatures({ features: ['ac', 'heating'], featuresConfirmed: ['ac'] })).toEqual(['heating']);
  });
});
