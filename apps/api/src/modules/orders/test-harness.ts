import { createHash } from 'node:crypto';
import { AZIZIYAH_MONEY_RULES, type LatLng, type PlaceOrderInput } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { NoDatabaseRunner, UnitOfWork } from '../../shared/db/unit-of-work.js';
import { InMemoryQueue } from '../../shared/queue.js';
import { CatalogService, InMemoryCatalogRepository } from '../catalog/index.js';
import { ConfigService } from '../config/index.js';
import { PricingService } from '../pricing/index.js';
import { EtaService, StraightLineRouter, type EtaCorrection } from '../routing/index.js';
import { InMemoryTripsRepository, RecordingTripEvents, ScriptedOfferCheck, TripsService, type TripTimerJob } from '../trips/index.js';
import { RecordingOrderEvents } from './events.adapter.js';
import { InMemoryMerchantDirectory } from './merchants.port.js';
import { InMemoryOrdersRepository } from './orders.repository.js';
import { OrdersService, type OrdersCashRiskPort, type OrderTimerJob } from './orders.service.js';
import type { ParticipantResolver } from './participants.js';
import type { PromotionQuery, PromotionsPort, ResolvedPromotion } from './promotions.port.js';
import { MerchantDealsPromotions } from './promotions.adapter.js';
import { InMemoryPromotionsRepository, dealBadge, type DealRecord } from '../promotions/index.js';
import { OrgsService } from '../orgs/index.js';
import { orgsHouseholds } from './households.port.js';
import { identityRiders, type RiderIdentity } from './riders.js';

/** Stand-in for identity's peppered HMAC: deterministic, and the number cannot be read back from it. */
export function fakePhoneHash(phone: string): string {
  return createHash('sha256').update(`test-pepper:${phone}`).digest('hex');
}

/**
 * Identity stood in for a ride booked for someone else (c9/s3): numbers are people (`people`, phone →
 * personId; an unknown number becomes `p_<digits>`), each booker's trusted list, household members'
 * cards, and the names the bookers gave, with every name read recorded.
 */
export class FakeRiderIdentity implements RiderIdentity {
  readonly trusted = new Map<string, Array<{ name: string; phoneE164: string }>>();
  readonly cards = new Map<string, { name: string | null; phoneMasked: string }>();
  readonly given = new Map<string, { personId: string; givenById: string; name: string }>();
  readonly reads: Array<{ ids: readonly string[]; accessorId: string; purpose: string }> = [];

  constructor(private readonly people: Map<string, string>) {}

  async riderByPhone(rawPhone: string): Promise<{ personId: string; phoneHash: string }> {
    const phone = rawPhone.replace(/\D/g, '').replace(/^964/, '0');
    const personId = this.people.get(phone) ?? `p_${phone}`;
    this.people.set(phone, personId);
    return { personId, phoneHash: fakePhoneHash(phone) };
  }

  async trustedContactsOf(personId: string): Promise<Array<{ name: string; phoneE164: string }>> {
    return this.trusted.get(personId) ?? [];
  }

  async memberCards(personIds: readonly string[]): Promise<Record<string, { name: string | null; phoneMasked: string }>> {
    return Object.fromEntries(personIds.flatMap((id) => (this.cards.has(id) ? [[id, this.cards.get(id)!]] : [])));
  }

  async phoneHashOf(personId: string): Promise<string | null> {
    const phone = [...this.people].find(([, id]) => id === personId)?.[0];
    return phone ? fakePhoneHash(phone) : null;
  }

  async rememberParticipantName(input: { participantId: string; personId: string; givenById: string; name: string }): Promise<void> {
    this.given.set(input.participantId, { personId: input.personId, givenById: input.givenById, name: input.name });
  }

  async participantNames(participantIds: readonly string[], accessorId: string, purpose: string): Promise<Record<string, string>> {
    this.reads.push({ ids: [...participantIds], accessorId, purpose });
    return Object.fromEntries(participantIds.flatMap((id) => (this.given.has(id) ? [[id, this.given.get(id)!.name]] : [])));
  }
}

/** rest_1's menu in the orders harness: fixed ids so tests can name them. */
export const HARNESS_MENU = [
  { id: 'kebab', nameAr: 'كباب', priceIqd: 5000 },
  { id: 'tikka', nameAr: 'تكة', priceIqd: 5000 },
  { id: 'tray', nameAr: 'صينية', priceIqd: 10000 },
  { id: 'tray_5k', nameAr: 'صينية صغيرة', priceIqd: 5000 },
  { id: 'tray_9k', nameAr: 'صينية وسط', priceIqd: 9000 },
  { id: 'x', nameAr: 'صنف', priceIqd: 1000 },
  {
    id: 'falafel',
    nameAr: 'فلافل',
    priceIqd: 1500,
    modifierGroups: [{ nameAr: 'إضافات', required: false, maxSelect: 2, modifiers: [{ nameAr: 'بيض', priceIqd: 500 }, { nameAr: 'جبن', priceIqd: 500 }] }],
  },
  { id: 'gus', nameAr: 'كص', priceIqd: 4000, branchOverrides: { kut: { priceIqd: 4500 }, closed_branch: { available: false } } },
  { id: 'soldout', nameAr: 'خلصان', priceIqd: 3000, stock: 0 },
  { id: 'breakfast', nameAr: 'فطور', priceIqd: 3000, availability: [{ dow: 6, start: '06:00', end: '11:00' }] },
];

export const KITCHEN: LatLng = { lat: 32.9105, lng: 45.0665 };
export const HOME: LatLng = { lat: 32.9185, lng: 45.0712 };

/** The ledger's new-customer cash rule (decisions §4) over a settable count of completed cash orders. */
export class FakeCashRisk implements OrdersCashRiskPort {
  readonly prior = new Map<string, number>();
  readonly asked: Array<{ customerId: string; totalIqd: number }> = [];

  async newCustomerCash(customerId: string, orderTotalIqd: number) {
    this.asked.push({ customerId, totalIqd: orderTotalIqd });
    const priorCashOrders = this.prior.get(customerId) ?? 0;
    const rule = AZIZIYAH_MONEY_RULES.newCustomerCash;
    const isNew = priorCashOrders < rule.firstOrders;
    return { allowed: !isNew || orderTotalIqd <= rule.maxOrderIqd, requiresArrivingCall: isNew, priorCashOrders };
  }
}

/**
 * A promotions double: codes resolve to what a test registers (by default none); merchant deals are
 * the real adapter over an in-memory promotions repository (`addDeal` puts an approved, running one).
 */
export class FakePromotions extends MerchantDealsPromotions implements PromotionsPort {
  readonly codes = new Map<string, ResolvedPromotion>();

  constructor(readonly dealRepo = new InMemoryPromotionsRepository()) {
    super({
      dealsOf: (id) => dealRepo.dealsOf(id),
      badges: async (id, at = new Date()) => (await dealRepo.dealsOf(id)).map((d) => dealBadge(d, at)).filter((b): b is NonNullable<typeof b> => b !== null),
      reserveSpend: (id, amount, tx) => dealRepo.reserveSpend(id, amount, tx),
      releaseSpend: (id, amount, tx) => dealRepo.releaseSpend(id, amount, tx),
    });
  }

  override async resolve(q: PromotionQuery): Promise<ResolvedPromotion | null> {
    return this.codes.get(q.code) ?? null;
  }

  /** An approved, switched-on deal (default: every day, all day, a week around 2026-10-03, no cap). */
  async addDeal(d: Partial<Omit<DealRecord, 'id'>> & Pick<DealRecord, 'type'>): Promise<DealRecord> {
    return this.dealRepo.createDeal({
      cityId: 'aziziyah',
      merchantOrgId: 'rest_1',
      ownerId: 'owner_1',
      nameAr: 'عرض',
      value: 0,
      itemIds: [],
      schedule: { startsAt: new Date('2026-09-30T00:00:00Z'), endsAt: new Date('2026-10-10T00:00:00Z'), days: [] },
      minOrderIqd: 0,
      budgetCapIqd: null,
      spentIqd: 0,
      projection: { ordersPerWeek: 0, costPerOrderIqd: 0, weeklyCostIqd: 0, totalCostIqd: 0, basisOrders: 0 },
      proposalState: 'approved',
      active: true,
      approvedAt: new Date('2026-09-30T00:00:00Z'),
      createdAt: new Date('2026-09-30T00:00:00Z'),
      ...d,
    });
  }

  async spent(dealId: string): Promise<number> {
    return (await this.dealRepo.deal(dealId))?.spentIqd ?? 0;
  }
}

/**
 * Orders + trips on in-memory everything, one fake clock, two in-memory timer queues, and a fake
 * outbox that forwards trip events to `orders.onTripEvent` when `deliver()` (or `advance`) runs.
 * Start: Saturday 2026-10-03 12:00 Baghdad. The one ETA is the straight-line router, uncorrected unless
 * `etaCorrection` gives it a learned correction (on the harness clock); placement locks the promise's
 * ride from it.
 */
export function ordersHarness(start = '2026-10-03T09:00:00Z', opts: { etaCorrection?: (clock: FakeClock) => EtaCorrection } = {}) {
  const clock = new FakeClock(start);
  const eta = new EtaService(new StraightLineRouter(), opts.etaCorrection?.(clock));
  const uow = new UnitOfWork(new NoDatabaseRunner());

  const tripEvents = new RecordingTripEvents();
  const tripsQueue = new InMemoryQueue<TripTimerJob>('trips.timers', () => clock.now());
  const tripsRepo = new InMemoryTripsRepository();
  const trips = new TripsService(tripsRepo, tripEvents, uow, clock, tripsQueue);
  trips.onModuleInit();
  // Dispatch is not in this harness: its open-offer check is stood in for (every offer passes).
  trips.bindOfferCheck(new ScriptedOfferCheck());

  const repo = new InMemoryOrdersRepository();
  const events = new RecordingOrderEvents();
  const queue = new InMemoryQueue<OrderTimerJob>('orders.timers', () => clock.now());
  const merchants = new InMemoryMerchantDirectory();
  merchants.add('rest_1', { location: { zoneKey: 'centre', pin: KITCHEN } });
  // `c1`, the customer of most tests, is an established account; `FakeCashRisk` applies the cap to everyone else.
  const cashRisk = new FakeCashRisk();
  cashRisk.prior.set('c1', 3);
  const people = new Map<string, string>(); // phone → personId
  const resolver: ParticipantResolver = { resolvePhone: async (phone) => ({ personId: people.get(phone) ?? null, phoneHash: fakePhoneHash(phone) }) };
  const pricing = new PricingService(new ConfigService());
  const promotions = new FakePromotions();
  // Menus (review C2: orders prices lines from the catalog, never from the client). Every harness
  // merchant serves HARNESS_MENU: rest_1 under the plain ids, others under `<org>/<id>`, which the
  // port below maps back so tests can say `catalogItemId: 'kebab'` for any merchant.
  const catalog = new CatalogService(new InMemoryCatalogRepository());
  const menus = new Map<string, Promise<unknown>>();
  const scoped = (orgId: string, id: string) => (orgId === 'rest_1' ? id : `${orgId}/${id}`);
  const ensureMenu = (orgId: string) => {
    if (!menus.has(orgId)) menus.set(orgId, Promise.all(HARNESS_MENU.map((m) => catalog.addItem({ ...m, id: scoped(orgId, m.id), orgId }))));
    return menus.get(orgId)!;
  };
  /** Wallet balances the harness's wallet port answers with (`customer:<id>` / `household:<id>`; points: `points:<id>`). */
  const wallets = new Map<string, number>();
  const placeOwners = new Map<string, string>();
  const placeDoors = new Map<string, { lat: number; lng: number }>();
  // Joy w4: households (payers, orderers, limits, budgets, approvals) on in-memory orgs.
  const orgs = new OrgsService(undefined, clock);
  const orders = new OrdersService(repo, events, uow, clock, queue, trips, pricing, merchants, resolver, cashRisk, {
    itemsOf: async (orgId, ids) => {
      if (await merchants.profile(orgId)) await ensureMenu(orgId);
      const found = await catalog.itemsOf(orgId, ids.flatMap((id) => [id, `${orgId}/${id}`]));
      return found.map((i) => ({ ...i, id: i.id.startsWith(`${orgId}/`) ? i.id.slice(orgId.length + 1) : i.id }));
    },
    // Opening hours and minimum: none until a test saves a storefront (`catalog.saveStorefront`).
    storefront: (orgId) => catalog.storefront(orgId),
  }, promotions, undefined, {
    // C-04: wallet balances by payer (customer or household); unset = 0.
    balanceIqd: async ({ customerId, householdId }) => wallets.get(householdId ? `household:${householdId}` : `customer:${customerId}`) ?? 0,
    // W-02: points balances by person (`points:<id>`); unset = 0.
    pointsBalance: async (customerId) => wallets.get(`points:${customerId}`) ?? 0,
  }, {
    // Maps program SP3d: saved places by owner (`placeOwners.set(placeId, personId)`).
    deliveryPlace: async (personId, placeId) => (placeOwners.get(placeId) === personId ? { door: placeDoors.get(placeId) ?? null } : null),
  }, orgsHouseholds(orgs), eta);
  orders.onModuleInit();
  // c9/s3: a ride for someone else, as OrdersModule binds it (identity stood in for).
  const riderIdentity = new FakeRiderIdentity(people);
  orders.bindRiders(identityRiders(riderIdentity, orgsHouseholds(orgs)));
  // "الخردة علينا": as OrdersModule binds it at start-up.
  trips.bindStartCodes({ codeOf: (orderId) => orders.startCodeOf(orderId) });
  trips.bindHandoverCheck({ check: (orderId, h) => (orderId ? orders.handoverProblem(orderId, h) : Promise.resolve(h.changeToWalletIqd !== undefined ? 'change_to_wallet_not_cash' : null)) });

  tripEvents.onEvent((e) => orders.onTripEvent({ type: e.type, tripId: e.tripId!, actorId: e.actorId, occurredAt: e.occurredAt, ...(e.orderId ? { orderId: e.orderId } : {}), payload: e.payload }));

  /** Publishes pending trip events to orders (the outbox drain). */
  const deliver = () => tripEvents.deliver();

  /** Moves time, runs every due timer on both queues and publishes what they emitted. */
  async function advance(ms: number): Promise<void> {
    clock.advance(ms);
    for (let i = 0; i < 5; i++) {
      const n = (await queue.drain()) + (await tripsQueue.drain()) + (await deliver());
      if (n === 0) break;
    }
  }

  function foodInput(patch: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
    return {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: 'rest_1',
      lines: [
        { catalogItemId: 'kebab', qty: 2, unitPriceIqd: 5000 },
        { catalogItemId: 'tikka', qty: 1, unitPriceIqd: 5000 },
      ],
      // centre (rest_1's kitchen) → zakur (mid): the server quotes 1,000 delivery + 500 service.
      dropoff: { zoneKey: 'zakur', pin: HOME },
      deliveryFeeIqd: 1000,
      serviceFeeIqd: 500,
      ...patch,
    };
  }

  /** The courier trip dispatch (Step 5) would create for an order. */
  async function tripFor(orderId: string, opts: { vertical?: 'food' | 'taxi'; driverId?: string; vehicleClass?: 'bike' | 'tuktuk' | 'car' } = {}) {
    const order = await orders.get(orderId);
    const t = await trips.createForOrders({
      cityId: 'aziziyah',
      vertical: opts.vertical ?? 'food',
      orders: [{ orderId, minVehicleClass: order.minVehicleClass }],
      stops: [
        { orderId, type: 'pickup', zoneKey: 'centre', target: KITCHEN },
        { orderId, type: 'dropoff', zoneKey: 'zakur', target: HOME },
      ],
    });
    await trips.offer(t.id);
    const driverId = opts.driverId ?? 'd1';
    await trips.accept(t.id, driverId, { vehicleClass: opts.vehicleClass ?? 'tuktuk' });
    await deliver();
    return trips.get(t.id);
  }

  async function pickup(tripId: string, driverId = 'd1') {
    const t = await trips.get(tripId);
    const s = t.stops.find((x) => x.type === 'pickup')!;
    await trips.arrive(tripId, s.id, driverId, { pin: KITCHEN });
    await trips.completeStop(tripId, s.id, driverId);
    await deliver();
  }

  async function dropoff(tripId: string, opts: { cashCollectedIqd?: number; changeToWalletIqd?: number; driverId?: string } = {}) {
    const driverId = opts.driverId ?? 'd1';
    const t = await trips.get(tripId);
    const s = t.stops.find((x) => x.type === 'dropoff')!;
    if (s.state === 'pending') await trips.arrive(tripId, s.id, driverId, { pin: HOME });
    await trips.completeStop(tripId, s.id, driverId, {
      handover: {
        ...(opts.cashCollectedIqd !== undefined ? { cashCollectedIqd: opts.cashCollectedIqd } : {}),
        ...(opts.changeToWalletIqd !== undefined ? { changeToWalletIqd: opts.changeToWalletIqd } : {}),
      },
    });
    await deliver();
  }

  return { clock, eta, uow, orgs, placeOwners, placeDoors, trips, tripsRepo, tripEvents, tripsQueue, repo, events, queue, merchants, people, riderIdentity, cashRisk, catalog, promotions, orders, wallets, deliver, advance, foodInput, tripFor, pickup, dropoff };
}
