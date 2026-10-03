import { TERMINAL_ORDER_STATES, type BoardCard, type Order, type RoleKind, type Trip } from '@driver/contracts';
import { customerStep, placeOrder } from './actors/customer.js';
import { dispatcherStep, type DispatcherState } from './actors/dispatcher.js';
import { driverOffers, driverSettle, driverShift, driverWork } from './actors/driver.js';
import { merchantHeartbeats, merchantStep } from './actors/merchant.js';
import {
  CITY,
  guarded,
  type DrainableQueue,
  type DriverRun,
  type HandoverRecord,
  type HotWaitRecord,
  type ObservedOffer,
  type OrderRun,
  type ReplayRecord,
  type RestaurantRun,
  type SimContext,
  type SimServices,
} from './context.js';
import type { QuarantinedEvent, SimSnapshot } from './invariants.js';
import { createRand } from './prng.js';
import { DAY_MINUTES, type PlannedOrder } from './scenario.js';
import type { World } from './world.js';

/** Who the simulator acts as when it grants roles (identity's `grantedBy`). */
const SIM_ACTOR = { personId: 'system:simulator' };
export const OBSERVER_SUBSCRIBER = 'simulator:observer';
const OFFER_EVENTS = ['dispatch.wave_sent', 'dispatch.offer_sent', 'dispatch.rebroadcast', 'dispatch.override'];

export interface EngineOptions {
  world: World;
  plan: PlannedOrder[];
  /** Sim time at which the day opens (10:00 local). */
  dayStart: Date;
  /** Live mode: sim seconds per real second. In-process: 1 (the fake clock is the sim clock). */
  speed?: number;
  /** In-process: the app's in-memory timer queues, drained as the fake clock advances. */
  queues?: readonly DrainableQueue[];
  /** In-process: moves the app's fake clock. Absent in live mode. */
  advanceClock?: (ms: number) => Date;
  /** The app's clock. */
  appNow: () => Date;
}

export interface Progress {
  simTime: Date;
  planned: number;
  placed: number;
  live: number;
  terminal: number;
  delivered: number;
  driversOnline: number;
  activeTrips: number;
}

/**
 * One simulation: the world, the plan, every actor's state, and the tick that moves them. Drives
 * only the public services in `SimServices`.
 */
export class Simulation implements SimContext {
  readonly orders = new Map<string, OrderRun>();
  readonly ordersById = new Map<string, OrderRun>();
  readonly drivers: DriverRun[] = [];
  readonly driversById = new Map<string, DriverRun>();
  readonly restaurants: RestaurantRun[] = [];
  readonly replays: ReplayRecord[] = [];
  readonly hotWaits: HotWaitRecord[] = [];
  readonly handovers: HandoverRecord[] = [];
  readonly offers: ObservedOffer[] = [];
  readonly refusals = new Map<string, number>();
  readonly errors: Array<{ where: string; message: string }> = [];
  readonly speed: number;
  dispatcherId = '';
  t: number;

  private readonly world_: World;
  private readonly plan: PlannedOrder[];
  private readonly dayStart: number;
  private readonly customers = new Map<number, string>();
  private readonly live: OrderRun[] = [];
  private readonly dispatcher: DispatcherState = { lastOverride: new Map() };
  private nextPlan = 0;
  private lastDispatcherT = -Infinity;
  private lastRetryDrainT = -Infinity;
  private unsubscribe: (() => void) | null = null;
  private cards: BoardCard[] = [];

  constructor(
    readonly s: SimServices,
    private readonly opts: EngineOptions,
  ) {
    this.world_ = opts.world;
    this.plan = opts.plan;
    this.dayStart = opts.dayStart.getTime();
    this.speed = opts.speed ?? 1;
    this.t = opts.advanceClock ? opts.appNow().getTime() : this.dayStart;
  }

  get world(): World {
    return this.world_;
  }

  get dayEnd(): number {
    return this.dayStart + DAY_MINUTES * 60_000;
  }

  appNow(): Date {
    return this.opts.appNow();
  }

  appDelaySec(simSec: number): number {
    return simSec / this.speed;
  }

  call<T>(where: string, fn: () => Promise<T>): Promise<T | null> {
    return guarded(this, where, fn);
  }

  // ───────────────────────── setup ─────────────────────────

  private async person(phone: string, roles: readonly RoleKind[]): Promise<string> {
    await this.call('setup.otp', () => this.s.identity.requestOtp({ phone, purpose: 'login' }));
    const { code } = await this.s.identity.devLastOtp(phone);
    const { personId } = await this.s.identity.verifyOtp({ phone, code: code! });
    for (const kind of roles) await this.s.identity.grantRole(SIM_ACTOR, { personId, kind });
    return personId;
  }

  async setup(): Promise<void> {
    this.dispatcherId = await this.person(`0790${String(this.world.seed % 1000).padStart(3, '0')}0000`, ['dispatcher']);
    for (const def of this.world.restaurants) {
      const ownerId = await this.person(`0790${String(this.world.seed % 1000).padStart(3, '0')}${String(this.restaurants.length + 1).padStart(4, '0')}`, []);
      const org = this.s.orgs.create({ type: 'restaurant', name: def.name_ar, cityId: CITY, ownerId });
      this.s.orgs.setMerchantSettings(org.id, { commissionTier: def.commissionTier, autoAccept: def.autoAccept, defaultPrepMin: def.defaultPrepMin, location: { zoneKey: def.zoneId, pin: def.pin } });
      const catalogIds = new Map<string, string>();
      for (const item of def.menu) catalogIds.set(item.id, (await this.s.catalog.addItem({ orgId: org.id, nameAr: item.name_ar, priceIqd: item.priceIqd })).id);
      this.restaurants.push({ def, orgId: org.id, catalogIds, ownerId, nextHeartbeatT: this.t });
    }
    await this.s.orgs.settled();
    for (const def of this.world.drivers) {
      const roles: RoleKind[] = def.vehicle === 'bike' ? ['courier'] : def.vehicle === 'car' ? ['driver'] : ['driver', 'courier'];
      const personId = await this.person(def.phone, roles);
      const d: DriverRun = {
        def,
        personId,
        rand: createRand(this.world.seed).fork(`driver:${def.key}`),
        pos: { ...def.home },
        started: false,
        online: false,
        loggedOff: false,
        offlineSinceT: null,
        offlineUntilT: null,
        bootT: this.t,
        trips: new Map(),
        handledOffers: new Set(),
        pending: [],
        queue: [],
        lastAcked: null,
        seq: 0,
        nextSettleCheckT: this.t,
        bag: new Map(),
      };
      this.drivers.push(d);
      this.driversById.set(personId, d);
    }
    // Watch offers as they are sent: the driver's cap position at that moment.
    this.unsubscribe = this.s.events.subscribe(OBSERVER_SUBSCRIBER, OFFER_EVENTS, async (e) => {
      const p = e.payload as { driverIds?: unknown; driverId?: unknown };
      const ids = Array.isArray(p.driverIds) ? (p.driverIds as string[]) : typeof p.driverId === 'string' ? [p.driverId] : [];
      for (const driverId of ids) {
        const st = await this.s.caps.status(driverId);
        this.offers.push({ tripId: e.tripId ?? e.aggregateId, driverId, at: this.t, kind: e.type, overCap: st.overCap, owedIqd: st.owedIqd, capIqd: st.capIqd });
      }
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private async customer(index: number): Promise<string> {
    const known = this.customers.get(index);
    if (known) return known;
    const c = this.world.customers[index]!;
    const id = await this.person(c.phone, ['customer']);
    this.customers.set(index, id);
    return id;
  }

  // ───────────────────────── the tick ─────────────────────────

  /** Advances the fake clock by `dtSec` (in-process) and runs one step of every actor. */
  async tick(dtSec: number): Promise<void> {
    if (this.opts.advanceClock) {
      this.t = this.opts.advanceClock(dtSec * 1000).getTime();
      await this.drainTimers();
    } else {
      this.t += dtSec * 1000;
    }
    if (this.t - this.lastRetryDrainT >= 60_000) {
      this.lastRetryDrainT = this.t;
      await this.call('events.drain', () => this.s.events.drain());
    }

    // Orders whose time has come.
    while (this.nextPlan < this.plan.length && this.dayStart + this.plan[this.nextPlan]!.atMin * 60_000 <= this.t) {
      const p = this.plan[this.nextPlan++]!;
      const run = this.newRun(p);
      run.customerId = await this.customer(p.customer);
      this.orders.set(p.key, run);
      await placeOrder(this, run);
      if (run.orderId) {
        this.ordersById.set(run.orderId, run);
        this.live.push(run);
      }
    }

    // Kitchens and customers react to their orders.
    await merchantHeartbeats(this);
    for (const run of [...this.live]) {
      const order = await this.call('order.get', () => this.s.orders.get(run.orderId!));
      if (!order) continue;
      run.state = order.state;
      if (TERMINAL_ORDER_STATES.includes(order.state)) {
        run.terminal = true;
        continue;
      }
      if (order.type === 'food') await merchantStep(this, run, order);
      await customerStep(this, run, order);
    }
    for (let i = this.live.length - 1; i >= 0; i -= 1) if (this.live[i]!.terminal) this.live.splice(i, 1);

    // The board: drivers see their offers; the dispatcher works the red cards.
    this.cards = (await this.call('dispatch.board', () => this.s.dispatch.board(CITY)))?.cards ?? [];
    const byDriver = new Map<string, Array<{ card: BoardCard; offerId: string }>>();
    for (const card of this.cards)
      for (const o of card.offers) {
        if (o.state !== 'sent' && o.state !== 'seen') continue;
        const list = byDriver.get(o.driverId) ?? [];
        list.push({ card, offerId: o.offerId });
        byDriver.set(o.driverId, list);
      }
    if (this.t - this.lastDispatcherT >= 15_000) {
      this.lastDispatcherT = this.t;
      await dispatcherStep(this, this.cards, this.dispatcher);
    }

    // Drivers act a moment after the desk: on a fake clock everything in a tick shares one
    // millisecond, and a replay "at" the very instant of its detach would not be after it.
    if (this.opts.advanceClock) this.t = this.opts.advanceClock(1).getTime();
    for (const d of this.drivers) {
      await driverShift(this, d, dtSec, this.dayStart);
      if (!d.started || d.loggedOff) continue;
      await driverOffers(this, d, byDriver.get(d.personId) ?? []);
      await driverWork(this, d, dtSec);
      await driverSettle(this, d);
    }
  }

  private newRun(plan: PlannedOrder): OrderRun {
    return {
      plan,
      rand: createRand(this.world.seed).fork(`order:${plan.key}`),
      customerId: '',
      restaurant: plan.restaurant === null ? null : this.restaurants[plan.restaurant]!,
      orderId: null,
      placeError: null,
      placedT: this.t,
      state: null,
      terminal: false,
      rideTripId: null,
      offerSeenT: null,
      decision: null,
      decideAt: null,
      prepMin: 0,
      acceptedT: null,
      readyT: null,
      preparingAt: null,
      stageT: {},
      cancelTried: false,
      partialSeenT: null,
      partialAnswerAt: null,
      partialAnswered: false,
      freeCancelSeen: false,
      answersAt: null,
      lastCourierId: null,
    };
  }

  private async drainTimers(): Promise<void> {
    for (let guard = 0; guard < 100; guard += 1) {
      let ran = 0;
      for (const q of this.opts.queues ?? []) {
        const n = await this.call(`timers.${q.name}`, () => q.drain());
        ran += n ?? 0;
      }
      if (ran === 0) return;
    }
  }

  // ───────────────────────── running a whole day in-process ─────────────────────────

  /** Runs the plan to the end of the day, lets every order finish and close, then settles the night. */
  async runDay(opts: { tickSec?: number; onProgress?: (p: Progress) => void } = {}): Promise<void> {
    const tick = opts.tickSec ?? 5;
    let lastReport = this.t;
    const report = () => {
      if (opts.onProgress && this.t - lastReport >= 60 * 60_000) {
        lastReport = this.t;
        opts.onProgress(this.progress());
      }
    };
    // The day, and the tail: every order delivered, completed or terminal.
    const hardStop = this.dayEnd + 3 * 60 * 60_000;
    while (this.t < this.dayEnd || this.nextPlan < this.plan.length || this.live.some((r) => !['delivered', 'completed'].includes(r.state ?? '')) || this.drivers.some((d) => d.trips.size > 0 || d.queue.length > 0)) {
      if (this.t >= hardStop) break;
      await this.tick(tick);
      report();
    }
    // Two hours later every delivered order auto-closes (domain §2).
    const closeBy = this.t + 2 * 60 * 60_000 + 5 * 60_000;
    while (this.t < closeBy && this.live.length > 0) {
      await this.tick(60);
      report();
    }
    await this.closeNight();
  }

  /** Nightly courier return route (decisions §3): every courier hands each merchant its cash. */
  async closeNight(): Promise<void> {
    for (const d of this.drivers) await driverSettle(this, d, { force: true, merchantsOnly: true });
    await this.call('events.drain', () => this.s.events.drain());
  }

  progress(): Progress {
    let delivered = 0;
    let terminal = 0;
    let placed = 0;
    for (const r of this.orders.values()) {
      if (r.orderId) placed += 1;
      if (r.terminal) terminal += 1;
      if (r.state === 'closed' || r.state === 'delivered' || r.state === 'completed') delivered += 1;
    }
    return {
      simTime: new Date(this.t),
      planned: this.plan.length,
      placed,
      live: this.live.length,
      terminal,
      delivered,
      driversOnline: this.drivers.filter((d) => d.online).length,
      activeTrips: this.drivers.reduce((n, d) => n + d.trips.size, 0),
    };
  }

  // ───────────────────────── the end-of-run snapshot ─────────────────────────

  async snapshot(): Promise<SimSnapshot> {
    const orders: Order[] = [];
    const tripIds = new Set<string>();
    for (const run of this.orders.values()) {
      if (!run.orderId) continue;
      orders.push(await this.s.orders.get(run.orderId));
      for (const link of await this.s.trips.orderHistory(run.orderId)) tripIds.add(link.tripId);
      if (run.rideTripId) tripIds.add(run.rideTripId);
    }
    const trips: Trip[] = [];
    const quarantined: QuarantinedEvent[] = [];
    for (const id of [...tripIds].sort()) {
      trips.push(await this.s.trips.get(id));
      for (const e of await this.s.events.forTrip(id)) {
        if (e.quarantined) quarantined.push({ id: e.id, type: e.type, tripId: e.tripId ?? null, orderId: e.orderId ?? null, recordedAt: e.recordedAt });
      }
    }
    const ledgerById = new Map<string, Awaited<ReturnType<SimServices['ledger']['eventsFor']>>[number]>();
    for (const account of await this.s.ledger.accounts()) for (const e of await this.s.ledger.eventsFor(account)) ledgerById.set(e.id, e);
    const merchants = [];
    for (const r of this.restaurants) merchants.push({ merchantId: r.orgId, balanceIqd: (await this.s.merchantCash.balance(r.orgId)).balanceIqd });
    return {
      orders,
      trips,
      ledger: [...ledgerById.values()],
      quarantined,
      outbox: await this.s.events.outboxStats(),
      offers: [...this.offers],
      replays: [...this.replays],
      hotWaits: [...this.hotWaits],
      handovers: [...this.handovers],
      merchants,
      errors: [...this.errors],
    };
  }
}

