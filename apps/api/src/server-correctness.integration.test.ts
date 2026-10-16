import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PriceRequest, SAFETY_RULES, type Actor } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { AppModule } from './app.module.js';
import { CatalogService } from './modules/catalog/index.js';
import { IdentityService } from './modules/identity/index.js';
import { PrismaIdentityRepository } from './modules/identity/identity.repository.js';
import { OrdersService } from './modules/orders/index.js';
import { HouseholdsRpc } from './modules/orgs/index.js';
import { PartnerService } from './modules/partner/index.js';
import { SavedPlacesService } from './modules/places/index.js';
import { PricingService } from './modules/pricing/index.js';
import { SafetyService } from './modules/safety/index.js';
import { TripsService } from './modules/trips/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';
import { PrismaService } from './shared/db/prisma.service.js';

/**
 * Server correctness on a real Postgres, through the app's own wiring (AppModule): an SOS is never
 * refused (FLOW-08); double taps are idempotent (RDB-04) and make one household (RDB-05); a gift recipient's name lives in the vault (SEC-14). Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const KITCHEN = { lat: 32.9105, lng: 45.0665 };
const STREET_30 = { lat: 32.9098, lng: 45.0628 };
const DAY = '2026-10-03T10:00:00Z'; // Saturday 13:00 in Baghdad: kitchens open, no prayer pause

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!url)('server correctness on Postgres (needs DATABASE_URL)', () => {
  const clock = new FakeClock(DAY);
  const run = Date.now().toString(36);
  const base = Date.now();
  const phone = (n: number) => `0773${String((base + n * 7919) % 10_000_000).padStart(7, '0')}`;
  let app: INestApplication;
  let db: PrismaService['prisma'];
  const people = { customer: '', driver: '' };
  const as = (personId: string): Actor => ({ personId, sessionId: `s_${run}` });
  const khalid = AZIZIYAH_RESTAURANTS.find((r) => r.key === 'khalid')!;
  const placeFood = (personId: string, clientRequestId?: string) =>
    app.get(OrdersService).place(personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 2 }],
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      ...(clientRequestId ? { clientRequestId } : {}),
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    db = app.get(PrismaService).prisma;
    const identity = app.get(IdentityService);
    people.customer = await identity.ensurePersonByPhone(phone(1), 'system:test', 'server_correctness_it', { name: 'زينب علي' });
    people.driver = await identity.ensurePersonByPhone(phone(2), 'system:test', 'server_correctness_it', { name: 'حيدر كاظم' });
  }, 60_000);

  afterAll(async () => {
    if (!app) return;
    // Let the outbox finish what this boot wrote before the app (and its Prisma client) closes.
    for (let i = 0; i < 50 && (await db.outbox.count({ where: { status: 'pending', attempts: 0 } })) > 0; i++) await new Promise((r) => setTimeout(r, 100));
    await app.close();
  });

  it('FLOW-08: a sixth SOS in an hour after five cancelled false alarms still opens an incident', async () => {
    clock.set(DAY);
    const safety = app.get(SafetyService);
    const order = await placeFood(people.customer);
    const press = (n: number) => safety.sos(as(people.customer), { subject: { kind: 'order', id: order.id }, position: null, clientId: `sos-${run}-${n}` });
    for (let i = 0; i < SAFETY_RULES.maxPerHour; i++) {
      const v = await press(i);
      expect(v.state).toBe('open');
      await safety.cancel(as(people.customer), { incidentId: v.incidentId });
      clock.advanceSeconds(60);
    }
    const real = await press(99);
    expect(real.state).toBe('open');
    const rows = await db.safetyIncident.findMany({ where: { raiserId: people.customer }, orderBy: { raisedAt: 'asc' } });
    expect(rows.map((r) => r.state)).toEqual([...Array<string>(SAFETY_RULES.maxPerHour).fill('cancelled'), 'open']);
    // Cancelled presses don't count: the real alert is not flagged as a repeat.
    const raised = await db.safetyIncidentEntry.findFirstOrThrow({ where: { incidentId: real.incidentId, kind: 'raised' } });
    expect((raised.data as Record<string, string>)['repeated']).toBeUndefined();
  }, 60_000);

  it('RDB-04: two identical places.save calls in parallel both succeed and leave one place', async () => {
    const places = app.get(SavedPlacesService);
    const input = { cityId: 'aziziyah', label: 'home' as const, name: 'البيت', pin: STREET_30, photoIds: [], shareWithHousehold: false, clientRef: `ref-${run}` };
    const [a, b] = await Promise.all([places.save(people.customer, input), places.save(people.customer, input)]);
    expect(a.id).toBe(b.id);
    expect(await db.place.count({ where: { ownerId: people.customer, clientRef: `ref-${run}` } })).toBe(1);
    // The one place kept its label (the twin's demote of «البيت» never sticks).
    expect((await places.mine(people.customer)).filter((p) => p.label === 'home').map((p) => p.id)).toEqual([a.id]);
  }, 30_000);

  it('RDB-04: two identical catalog.followDish calls in parallel both succeed and leave one row', async () => {
    const catalog = app.get(CatalogService);
    const itemId = `${khalid.orgId}_pepsi`;
    const [a, b] = await Promise.all([catalog.followDish(people.customer, khalid.orgId, itemId, true), catalog.followDish(people.customer, khalid.orgId, itemId, true)]);
    expect(a.map((f) => f.itemId)).toContain(itemId);
    expect(b.map((f) => f.itemId)).toContain(itemId);
    expect(await db.dishFollow.count({ where: { personId: people.customer, itemId } })).toBe(1);
  }, 30_000);

  it('RDB-04: two identical orders.rate calls in parallel both succeed and leave one courier rating', async () => {
    clock.set(DAY);
    const orders = app.get(OrdersService);
    const quote = await app
      .get(PricingService)
      .keepQuote(PriceRequest.parse({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'centre', type: 'pickup', pin: KITCHEN }, { zoneId: 'street_30', type: 'dropoff', pin: STREET_30 }], options: { doorPickup: false, streetHandover: false }, at: clock.now() }));
    const ride = await orders.place(people.customer, { cityId: 'aziziyah', type: 'ride', rideVertical: 'taxi', fareIqd: quote.total, quoteId: quote.id, pickup: { zoneKey: 'centre', pin: KITCHEN }, dropoff: { zoneKey: 'street_30', pin: STREET_30 }, clientRequestId: `rate-${run}` });
    const trip = await waitFor('the ride trip', () => app.get(TripsService).activeForOrder(ride.id));
    // The driver carried it and the ride is over (stood in by the rows the trip would write).
    await db.trip.update({ where: { id: trip.id }, data: { courierId: people.driver, acceptedAt: clock.now() } });
    await db.order.update({ where: { id: ride.id }, data: { state: 'completed', deliveredAt: clock.now() } });
    const [a, b] = await Promise.all([orders.rate(people.customer, { orderId: ride.id, delivery: 5 }), orders.rate(people.customer, { orderId: ride.id, delivery: 5 })]);
    expect(a.id).toBe(ride.id);
    expect(b.id).toBe(ride.id);
    expect(await db.courierRating.count({ where: { orderId: ride.id } })).toBe(1);
    // FLOW-20 (W3): rating no longer closes it; the 2-h auto-close does.
    const rated = await db.order.findUniqueOrThrow({ where: { id: ride.id } });
    expect(rated.state).toBe('completed');
    expect(rated.ratedAt).not.toBeNull();
    // The Console's "Today" event commits with the winning rating only.
    expect(await db.event.count({ where: { aggregate: 'order', aggregateId: ride.id, type: 'order.rated' } })).toBe(1);
  }, 60_000);

  it('RDB-05: two parallel household.create calls by the same person make one household', async () => {
    const identity = app.get(IdentityService);
    const payer = await identity.ensurePersonByPhone(phone(3), 'system:test', 'server_correctness_it', { name: 'علي حسين' });
    const rpc = app.get(HouseholdsRpc);
    const results = await Promise.allSettled([rpc.create(as(payer), { name: 'بيت علي', cityId: 'aziziyah' }), rpc.create(as(payer), { name: 'بيت علي', cityId: 'aziziyah' })]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    const [a, b] = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value);
    expect(a!.id).toBe(b!.id);
    expect(await db.orgMember.count({ where: { personId: payer, role: 'payer', org: { type: 'household' } } })).toBe(1);
  }, 30_000);

  it('SEC-14: a gift recipient’s name lives in the vault; the courier card shows it through a logged read', async () => {
    clock.set(DAY);
    const orders = app.get(OrdersService);
    const gift = await orders.place(people.customer, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: `${khalid.orgId}_pepsi`, qty: 1 }],
      dropoff: { zoneKey: 'street_30', pin: STREET_30 },
      participants: [{ ref: 'recipient', role: 'recipient', label: 'أم زينب', phone: phone(9) }],
      gift: { hidePrices: false },
    });
    const recipient = gift.participants.find((p) => p.role === 'recipient')!;
    // Public schema: no name. Vault: the name, given by the orderer.
    expect((await db.participant.findUniqueOrThrow({ where: { id: recipient.id } })).label).toBeNull();
    const vault = new PrismaIdentityRepository(app.get(PrismaService));
    expect(await vault.readParticipantIdentities([recipient.id])).toEqual([{ participantId: recipient.id, personId: people.customer, givenById: people.customer, name: 'أم زينب' }]);
    // A courier carries it: his job card names whom to hand it to.
    const trip = await app.get(TripsService).createForOrders({
      cityId: 'aziziyah',
      vertical: 'food',
      orders: [{ orderId: gift.id }],
      stops: [
        { orderId: gift.id, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId: gift.id, type: 'dropoff', zoneKey: 'street_30', target: STREET_30 },
      ],
    });
    await db.trip.update({ where: { id: trip.id }, data: { courierId: people.driver, acceptedAt: clock.now(), state: 'en_route_to_pickup' } });
    const job = await app.get(PartnerService).activeJob(as(people.driver));
    const drop = job!.stops.find((st) => st.type === 'dropoff')!;
    expect(drop.recipient).toEqual({ name: 'أم زينب' });
    expect(job!.stops.find((st) => st.type === 'pickup')!.recipient ?? null).toBeNull();
    // The courier's read is in the vault access log (subject: the orderer, who named a recipient with no account).
    const logs = (await vault.vaultAccessLogs(people.customer)).filter((l) => l.accessorId === people.driver && l.purpose === 'partner_recipient');
    expect(logs.map((l) => l.fieldsRead)).toEqual([['participant_name']]);
    // The orderer reads his own order with the name; the plain view has none.
    const [mine] = await orders.withRiders([await orders.get(gift.id)], people.customer);
    expect(mine!.participants.find((p) => p.role === 'recipient')!.label).toBe('أم زينب');
    expect((await orders.get(gift.id)).participants.find((p) => p.role === 'recipient')!.label).toBeNull();
  }, 60_000);
});
