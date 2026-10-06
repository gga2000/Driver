import { isDriverError, type LatLng, type OrderState, type Trip } from '@driver/contracts';
import type { DispatchService } from '../dispatch/index.js';
import type { EventsService } from '../events/index.js';
import type { IdentityService } from '../identity/index.js';
import type { CatalogService } from '../catalog/index.js';
import type { CapsService, LedgerService, MerchantCashService, ShiftGuaranteeService } from '../ledger/index.js';
import type { OrdersService, OrderTipsService } from '../orders/index.js';
import type { OrgsService } from '../orgs/index.js';
import type { PricingService } from '../pricing/index.js';
import type { TripsService } from '../trips/index.js';
import type { Rand } from './prng.js';
import type { PlannedOrder } from './scenario.js';
import type { SimDriver, SimRestaurant, World } from './world.js';

/**
 * The real application services the simulator drives (plan Step 7: "through the REAL app services,
 * not mocks"). The in-memory run gets them from an `AppModule` booted on a `FakeClock`; the live
 * Console mode from the running API.
 */
export interface SimServices {
  identity: IdentityService;
  orgs: OrgsService;
  /** Menus: each restaurant's items are registered here and orders prices lines from it (review C2). */
  catalog: CatalogService;
  orders: OrdersService;
  trips: TripsService;
  dispatch: DispatchService;
  pricing: PricingService;
  ledger: LedgerService;
  caps: CapsService;
  merchantCash: MerchantCashService;
  /** G-91 shift guarantee: the Sunday run's settlement, applied to the simulated day. */
  guarantee: ShiftGuaranteeService;
  events: EventsService;
  /** «تحب تكرم عباس؟»: the tip after a 4–5 rating (wallet → driver). */
  tips: OrderTipsService;
}

/** In-memory timer queues the in-process run drains on the fake clock (empty in live mode: the app polls its own). */
export interface DrainableQueue {
  readonly name: string;
  drain(at?: Date): Promise<number>;
}

export const CITY = 'aziziyah';

/** One planned order as it unfolds: what the customer and the kitchen have seen and done, in sim time. */
export interface OrderRun {
  plan: PlannedOrder;
  rand: Rand;
  customerId: string;
  restaurant: RestaurantRun | null;
  orderId: string | null;
  placeError: string | null;
  placedT: number;
  state: OrderState | null;
  terminal: boolean;
  /** Ride: the trip the customer's request created. */
  rideTripId: string | null;
  // kitchen
  offerSeenT: number | null;
  decision: 'accept' | 'reject' | 'partial' | null;
  decideAt: number | null;
  prepMin: number;
  acceptedT: number | null;
  /** When the food is really ready (sim truth); the kitchen taps "ready" then. */
  readyT: number | null;
  preparingAt: number | null;
  // customer
  stageT: Partial<Record<'placed' | 'accepted' | 'searching' | 'driver_en_route', number>>;
  cancelTried: boolean;
  /** The customer has had his say after delivery (rated, maybe tipped, or let it auto-close). */
  rated: boolean;
  partialSeenT: number | null;
  partialAnswerAt: number | null;
  partialAnswered: boolean;
  freeCancelSeen: boolean;
  /** When the customer at the door finally answers (unreachable customers). */
  answersAt: number | null;
  /** Sim-time the courier became the one carrying it (food) or the driver accepted (ride). */
  lastCourierId: string | null;
}

export interface RestaurantRun {
  def: SimRestaurant;
  orgId: string;
  /** World menu item id → the catalog item id the app priced it under. */
  catalogIds: Map<string, string>;
  ownerId: string;
  nextHeartbeatT: number;
}

export type ActionKind = 'arrive' | 'complete' | 'unreachable';

/** A driver tap, as the Partner app queues it: idempotency key, device time and monotonic uptime. */
export interface DriverAction {
  kind: ActionKind;
  tripId: string;
  stopId: string;
  orderId: string | null;
  key: string;
  occurredAt: Date;
  uptimeMs: number;
  pin: LatLng;
  cashIqd?: number | undefined;
  /** "الخردة علينا": no change on him — this much of `cashIqd` goes to the customer's wallet. */
  changeToWalletIqd?: number | undefined;
}

export interface DriverTrip {
  tripId: string;
  vertical: string;
  /** The last server view (an offline driver keeps working from it). */
  view: Trip;
  /** What the driver believes about each stop (server state plus his own queued taps). */
  local: Map<string, 'arrived' | 'completed'>;
  arrivedT: Map<string, number>;
  unreachableStarted: Set<string>;
  /** Batched: he held another job when he accepted this one. */
  batched: boolean;
  acceptedT: number;
}

export interface DriverRun {
  def: SimDriver;
  personId: string;
  rand: Rand;
  pos: LatLng;
  started: boolean;
  online: boolean;
  loggedOff: boolean;
  offlineSinceT: number | null;
  offlineUntilT: number | null;
  /** Device boot (sim ms): uptime = now − boot. */
  bootT: number;
  trips: Map<string, DriverTrip>;
  handledOffers: Set<string>;
  pending: Array<{ offerId: string; tripId: string; at: number; decision: 'accept' | 'decline' | 'ignore' }>;
  queue: DriverAction[];
  lastAcked: DriverAction | null;
  seq: number;
  nextSettleCheckT: number;
  /** Food orders in his bag: orderId → when it was ready (ms) for the hot-wait check. */
  bag: Map<string, { readyAtMs: number; lateMs: number; batched: boolean; pickedUpT: number; offline: boolean; departed: boolean }>;
}

/** Offers the observer saw being sent, with the driver's cap position at that moment. */
export interface ObservedOffer {
  tripId: string;
  driverId: string;
  at: number;
  kind: string;
  overCap: boolean;
  owedIqd: number;
  capIqd: number;
}

/** One replayed offline action and what it changed. */
export interface ReplayRecord {
  driverId: string;
  key: string;
  action: string;
  tripId: string;
  orderId: string | null;
  kind: 'duplicate' | 'fresh';
  /** The (trip, order) pair was detached before the replay reached the server. */
  detached: boolean;
  eventsAdded: number;
  quarantinedAdded: number;
  ledgerAdded: number;
  outcome: string;
}

export interface HotWaitRecord {
  orderId: string;
  courierId: string;
  /** The later of the promised and the actual ready time: what batching plans against, unless the kitchen ran late. */
  readyAtMs: number;
  departAtMs: number;
  /** Wait from ready to leaving the last kitchen, less any lateness of the kitchens picked up after it. */
  waitMin: number;
  rawWaitMin: number;
  /** How late (vs its promise) the latest later kitchen in the batch was: the courier had to wait for it. */
  kitchenLateMin: number;
  /** His phone went dark while the food was in the bag: an incident, not a batching decision. */
  courierOffline: boolean;
}

export interface HandoverRecord {
  merchantId: string;
  courierId: string;
  amountIqd: number;
}

/** What a courier recorded at a cash drop-off ("الخردة علينا": the whole note when he had no change). */
export interface DoorCashRecord {
  orderId: string;
  courierId: string;
  collectedIqd: number;
  /** Of `collectedIqd`, what went to the customer's wallet (0 = he gave change). */
  changeToWalletIqd: number;
}

/** Shared state actors read and write. */
export interface SimContext {
  readonly s: SimServices;
  readonly world: World;
  /** Simulated now (ms). */
  readonly t: number;
  /** Simulated seconds per real second (1 in-process: the fake clock is the sim clock). */
  readonly speed: number;
  readonly orders: Map<string, OrderRun>;
  readonly ordersById: Map<string, OrderRun>;
  readonly drivers: DriverRun[];
  readonly driversById: Map<string, DriverRun>;
  readonly restaurants: RestaurantRun[];
  readonly dispatcherId: string;
  /** Offer ids the ops desk sent by hand (`dispatch.override`). */
  readonly deskOffers: ReadonlySet<string>;
  readonly replays: ReplayRecord[];
  readonly hotWaits: HotWaitRecord[];
  readonly handovers: HandoverRecord[];
  /** Cash drop-offs the server accepted, by order (replays overwrite with the same figures). */
  readonly doorCash: Map<string, DoorCashRecord>;
  /** Service calls refused with a DriverError, by code (expected in a busy city). */
  readonly refusals: Map<string, number>;
  /** Anything else a service threw (a bug). */
  readonly errors: Array<{ where: string; message: string }>;
  /** The application's clock (device time on taps); equals the sim clock in-process. */
  appNow(): Date;
  /** Sim duration → app duration (live mode compresses time; 1 in-process). */
  appDelaySec(simSec: number): number;
  /** Runs a service call: DriverErrors are counted refusals (returns null), anything else is recorded. */
  call<T>(where: string, fn: () => Promise<T>): Promise<T | null>;
}

export async function guarded<T>(ctx: Pick<SimContext, 'refusals' | 'errors'>, where: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (isDriverError(err)) {
      const k = `${where}:${err.code}`;
      ctx.refusals.set(k, (ctx.refusals.get(k) ?? 0) + 1);
      return null;
    }
    ctx.errors.push({ where, message: (err as Error).message ?? String(err) });
    return null;
  }
}
