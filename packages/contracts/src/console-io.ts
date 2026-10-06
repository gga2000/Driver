import { z } from 'zod';
import { CityId, Iqd, LatLng } from './common.js';
import { Event } from './event.js';
import { CapRole, SettlementMode } from './ledger-rules.js';
import { OrderState, OrderType, PaymentMethod } from './order.js';
import { VehicleClass } from './trip.js';

/**
 * Read-side IO of the Console (console spec: dispatch board, drivers, orders history, system).
 * Every procedure here is a read across modules; the API composes them in its `console` module
 * from each owning module's public service, never from another module's tables.
 */

// ───────────────────────── live driver positions (dispatch.drivers) ─────────────────────────

/**
 * Map marker state (console spec "Dispatch board"): free, offered (an unanswered offer), on job,
 * over cap (free but excluded from offers until he settles), recently offline (no heartbeat for a
 * minute, still inside the 90-s presence TTL).
 */
export const DriverPinState = z.enum(['free', 'offered', 'on_job', 'over_cap', 'offline_recent']);
export type DriverPinState = z.infer<typeof DriverPinState>;

/** Seconds without a heartbeat after which an online driver shows as recently offline. */
export const OFFLINE_RECENT_AFTER_SEC = 60;

export const DriverTier = z.enum(['bronze', 'silver', 'gold']);
export type DriverTier = z.infer<typeof DriverTier>;

export const DriverPin = z.object({
  driverId: z.string(),
  cityId: CityId,
  lat: LatLng.shape.lat,
  lng: LatLng.shape.lng,
  /** Degrees clockwise from north; null until the app reports it. */
  heading: z.number().min(0).max(360).nullable(),
  state: DriverPinState,
  vehicleClass: VehicleClass,
  tier: DriverTier,
  zoneId: z.string().nullable(),
  lastSeenAt: z.coerce.date(),
  /** Cash in his hands right now (the `cash:` account, positive). */
  cashHeldIqd: Iqd,
  /** What counts against the cap (cash not his, net of what the platform owes him). */
  owedIqd: Iqd,
  capIqd: Iqd,
  overCap: z.boolean(),
  /** The trip he is on, or the one he is being offered. */
  tripId: z.string().nullable(),
});
export type DriverPin = z.infer<typeof DriverPin>;

export const DriverPositionsInput = z.object({ cityId: CityId });
export const DriverPositions = z.object({ cityId: CityId, at: z.coerce.date(), drivers: z.array(DriverPin) });
export type DriverPositions = z.infer<typeof DriverPositions>;

// ───────────────────────── drivers roster (drivers.list) ─────────────────────────

/** Roles that drive for the platform and appear on the roster (same set as the cash caps). */
export const RosterRole = CapRole;
export type RosterRole = z.infer<typeof RosterRole>;

export const DriversListInput = z.object({
  cityId: CityId,
  filter: z
    .object({
      role: RosterRole.optional(),
      presence: z.enum(['all', 'online', 'offline']).default('all'),
      /** Person id substring (case-insensitive). Names stay in the vault. */
      q: z.string().trim().max(100).optional(),
      /**
       * Display name ("حيدر", "حيدر ك"), spelling-folded (`searchScore`). The API reads the names
       * from the vault and logs a read against the staff member for every person it returns.
       */
      name: z.string().trim().min(1).max(60).optional(),
      /** Scorecard tier. */
      tier: DriverTier.optional(),
      /** Only drivers with an approved document that has expired or expires within 30 days. */
      docsExpiring: z.boolean().optional(),
    })
    .default({}),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type DriversListInput = z.input<typeof DriversListInput>;

export const DriverRosterRow = z.object({
  personId: z.string(),
  roles: z.array(RosterRole),
  /** Every driving role is frozen until he re-verifies by OTP (edge-case §7). */
  frozen: z.boolean(),
  trustTier: z.string(),
  joinedAt: z.coerce.date(),
  online: z.boolean(),
  /** Live state when online; null when offline. */
  state: DriverPinState.nullable(),
  vehicleClass: VehicleClass.nullable(),
  zoneId: z.string().nullable(),
  lastSeenAt: z.coerce.date().nullable(),
  tripId: z.string().nullable(),
  /** Scorecard tier and index (M2 event counting). */
  tier: DriverTier,
  scoreIndex: z.number().int().min(0).max(100),
  observation: z.boolean(),
  /** Today (Baghdad day): jobs and net earnings, from the driver's book. Null when not read. */
  today: z.object({ jobs: z.number().int().nonnegative(), earningsIqd: Iqd }).nullable().default(null),
  /** Cash in his hands and what counts against his cap, now. Null when not read. */
  cash: z.object({ heldIqd: Iqd, owedIqd: Iqd, capIqd: Iqd, overCap: z.boolean() }).nullable().default(null),
  /** The soonest-expiring approved document that has expired or expires within 30 days; null when none. */
  docs: z.object({ state: z.enum(['expiring', 'expired']), expiresAt: z.coerce.date() }).nullable().default(null),
});
export type DriverRosterRow = z.infer<typeof DriverRosterRow>;

export const DriversPage = z.object({
  rows: z.array(DriverRosterRow),
  nextCursor: z.string().nullable(),
  /** People holding a driving role (before the presence filter). */
  total: z.number().int().nonnegative(),
});
export type DriversPage = z.infer<typeof DriversPage>;

// ───────────────────────── orders history (orders.search) ─────────────────────────

export const OrderSearchInput = z.object({
  cityId: CityId,
  states: z.array(OrderState).max(OrderState.options.length).optional(),
  type: OrderType.optional(),
  merchantOrgId: z.string().min(1).optional(),
  paymentMethod: PaymentMethod.optional(),
  /** The customer's drop-off zone (`dropoff.zoneKey`). */
  zoneKey: z.string().trim().min(1).max(60).optional(),
  /** Only active orders behind their promise (the lateness rule of the orders module). */
  late: z.boolean().optional(),
  /**
   * Matches order, orderer or merchant id, or the note (case-insensitive substring). An order
   * number — "1284", "#1284" or "١٢٨٤" (see `parseOrderTicket`) — instead finds every order with
   * that ticket number; without `from` it looks back over today and yesterday (Baghdad).
   */
  text: z.string().trim().max(100).optional(),
  /** Placed at or after (inclusive). */
  from: z.coerce.date().optional(),
  /** Placed before (exclusive). */
  to: z.coerce.date().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type OrderSearchInput = z.input<typeof OrderSearchInput>;

export const OrderSummary = z.object({
  id: z.string(),
  cityId: CityId,
  type: OrderType,
  state: OrderState,
  ordererId: z.string(),
  merchantOrgId: z.string().nullable(),
  paymentMethod: PaymentMethod,
  totalIqd: Iqd,
  placedAt: z.coerce.date(),
  acceptedAt: z.coerce.date().nullable(),
  promisedReadyAt: z.coerce.date().nullable(),
  pickedUpAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  closedAt: z.coerce.date().nullable(),
  cancelledAt: z.coerce.date().nullable(),
  /** Active and behind its promise (see the orders module's lateness rule). */
  late: z.boolean(),
  /** How far behind, in whole minutes, while `late`; null otherwise. */
  lateMin: z.number().int().nonnegative().nullable().default(null),
  /** The customer's drop-off zone, when the order has one. */
  zoneKey: z.string().nullable().default(null),
});
export type OrderSummary = z.infer<typeof OrderSummary>;

/** Newest first; `nextCursor` continues the same query. */
export const OrderSearchPage = z.object({ rows: z.array(OrderSummary), nextCursor: z.string().nullable() });
export type OrderSearchPage = z.infer<typeof OrderSearchPage>;

// ───────────────────────── event logs (orders.events / trips.events) ─────────────────────────

/** One row of the actor event log, as recorded; quarantined late replays are kept and marked. */
export const EventLogEntry = Event.extend({
  aggregate: z.string(),
  aggregateId: z.string(),
  skewMs: z.number().int(),
  flagged: z.boolean(),
  quarantined: z.boolean(),
});
export type EventLogEntry = z.infer<typeof EventLogEntry>;
export const EventLog = z.array(EventLogEntry);

// ───────────────────────── an order's ledger lines (orders.ledger) ─────────────────────────

/** One posting of an order: who paid whom and why. The Console says it in words ("للمطعم"). */
export const OrderLedgerLine = z.object({
  id: z.string(),
  at: z.coerce.date(),
  type: z.string(),
  label_ar: z.string(),
  amountIqd: Iqd,
  fromAccount: z.string(),
  toAccount: z.string(),
  memo: z.string().nullable(),
});
export type OrderLedgerLine = z.infer<typeof OrderLedgerLine>;

// ───────────────────────── right-now bar (console.rightNow) ─────────────────────────

export const RightNowInput = z.object({ cityId: CityId });
export const RightNow = z.object({
  cityId: CityId,
  at: z.coerce.date(),
  /** Orders placed in the last 60 minutes. */
  ordersLastHour: z.number().int().nonnegative(),
  activeOrders: z.number().int().nonnegative(),
  lateOrders: z.number().int().nonnegative(),
  /** Online drivers with a fresh heartbeat. */
  activeDrivers: z.number().int().nonnegative(),
  /** Mean seconds from offer to driver acceptance over the last hour; null when none. */
  avgTimeToAcceptSec: z.number().int().nonnegative().nullable(),
  /** Cash couriers and drivers hold right now (ledger `cash:` accounts). */
  cashInFieldIqd: Iqd,
  outbox: z.object({ pending: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }),
});
export type RightNow = z.infer<typeof RightNow>;

// ───────────────────────── system (system.outbox / system.simulator) ─────────────────────────

export const OutboxFailedRow = z.object({
  id: z.string(),
  eventId: z.string(),
  type: z.string(),
  aggregate: z.string(),
  aggregateId: z.string(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type OutboxFailedRow = z.infer<typeof OutboxFailedRow>;

export const OutboxView = z.object({
  pending: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** The 20 most recent failed rows, newest first. */
  recentFailed: z.array(OutboxFailedRow),
});
export type OutboxView = z.infer<typeof OutboxView>;

/** Live simulator progress (sim time and counts) while a Console-started run is going. */
export const SimulatorProgress = z.object({
  simTime: z.coerce.date(),
  planned: z.number().int().nonnegative(),
  placed: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  terminal: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  driversOnline: z.number().int().nonnegative(),
  activeTrips: z.number().int().nonnegative(),
});
export type SimulatorProgress = z.infer<typeof SimulatorProgress>;

/** Summary of the latest finished (or stopped) run; the full report is `simulation-report.json`. */
export const SimulatorReportSummary = z.object({
  ok: z.boolean(),
  mode: z.enum(['in_process', 'live']),
  endedAt: z.coerce.date(),
  orders: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  deliveredShare: z.number().min(0).max(1),
  invariants: z.number().int().nonnegative(),
  violations: z.array(z.object({ invariant: z.string(), count: z.number().int().positive() })),
});
export type SimulatorReportSummary = z.infer<typeof SimulatorReportSummary>;

/**
 * `available: false` only from an API without the simulator. `speed`, `progress` (while running) and
 * `lastReport` are optional additions (plan Step 7 live mode); older clients ignore them.
 */
export const SimulatorStatus = z.object({
  available: z.boolean(),
  running: z.boolean().default(false),
  startedAt: z.coerce.date().nullable().default(null),
  drivers: z.number().int().nonnegative().default(0),
  ordersPerHour: z.number().int().nonnegative().default(0),
  speed: z.number().positive().optional(),
  progress: SimulatorProgress.optional(),
  lastReport: SimulatorReportSummary.optional(),
});
export type SimulatorStatus = z.infer<typeof SimulatorStatus>;

export const SimulatorStartInput = z.object({
  cityId: CityId,
  drivers: z.number().int().min(1).max(500).default(20),
  ordersPerHour: z.number().int().min(1).max(5000).default(60),
  seed: z.number().int().optional(),
  /** Simulated seconds per real second (default 60×). */
  speed: z.number().min(1).max(3600).optional(),
});
export type SimulatorStartInput = z.input<typeof SimulatorStartInput>;

// ───────────────────────── merchants picker (merchants.list) ─────────────────────────

export const MerchantsListInput = z.object({ cityId: CityId });
export const MerchantRow = z.object({
  merchantId: z.string(),
  name: z.string(),
  type: z.enum(['restaurant', 'grocer']),
  cityId: CityId,
  /** Live merchant-cash balance (positive = the merchant is owed). */
  balanceIqd: Iqd,
  mode: SettlementMode,
  exposureCapIqd: Iqd,
  overExposure: z.boolean(),
  lastHeartbeatAt: z.coerce.date().nullable(),
});
export type MerchantRow = z.infer<typeof MerchantRow>;
export const MerchantList = z.array(MerchantRow);

// ───────────────────────── names (console.names) ─────────────────────────

/** Most ids of each kind one `console.names` call resolves (a page's worth). */
export const CONSOLE_NAMES_MAX = 200;
const NameRef = z.string().trim().min(1).max(100);

/**
 * K-01: the Console shows people, restaurants and dishes by name, not by id. One batched read per
 * page: person ids (drivers, customers, merchant staff — whoever appears), merchant org ids and
 * catalog items (by their org).
 */
export const ConsoleNamesInput = z.object({
  personIds: z.array(NameRef).max(CONSOLE_NAMES_MAX).default([]),
  orgIds: z.array(NameRef).max(CONSOLE_NAMES_MAX).default([]),
  items: z.array(z.object({ orgId: NameRef, itemId: NameRef })).max(CONSOLE_NAMES_MAX).default([]),
});
export type ConsoleNamesInput = z.input<typeof ConsoleNamesInput>;

/**
 * A person as staff see them: first name and the family initial ("حيدر ك."), read through the
 * identity vault with one access-log row per person read. A deleted account is marked and nothing
 * is read; a person without a name in the vault has `displayName: null`. Drivers also carry the
 * registry vehicle they are the active driver of (class and plate), when there is one.
 */
export const ConsolePersonName = z.object({
  displayName: z.string().nullable(),
  deleted: z.boolean(),
  vehicleClass: VehicleClass.nullable(),
  plate: z.string().nullable(),
});
export type ConsolePersonName = z.infer<typeof ConsolePersonName>;

/** Unknown ids are left out; the Console then shows the raw id. */
export const ConsoleNames = z.object({
  people: z.record(z.string(), ConsolePersonName),
  orgs: z.record(z.string(), z.object({ name: z.string(), type: z.string() })),
  /** Keyed `${orgId}:${itemId}` (see `consoleItemKey`). */
  items: z.record(z.string(), z.object({ name: z.string() })),
});
export type ConsoleNames = z.infer<typeof ConsoleNames>;

export function consoleItemKey(orgId: string, itemId: string): string {
  return `${orgId}:${itemId}`;
}

// ───────────────────────── the port ─────────────────────────

/**
 * Replay of one order (maps program o2): the courier's stored GPS trail per trip (30 days, decision
 * D6), the stops, and the moments that matter (accepted, arrived, picked up, delivered) with where
 * they happened. Settles "he never came" in seconds.
 */
export const REPLAY_RULES = {
  /** Points per trip at most (evenly thinned beyond). */
  maxPoints: 3_000,
  /** Event types marked on the replay's timeline. */
  marks: ['trip.accepted', 'stop.geofence_entered', 'stop.arrived', 'stop.completed', 'stop.courier_near', 'trip.unreachable_started', 'trip.completed', 'order.cancelled'] as readonly string[],
} as const;

export const OrderReplay = z.object({
  orderId: z.string(),
  legs: z.array(
    z.object({
      tripId: z.string(),
      courierId: z.string().nullable(),
      points: z.array(z.object({ lat: z.number(), lng: z.number(), at: z.coerce.date(), speedKmh: z.number().nullable() })),
      stops: z.array(z.object({ type: z.string(), lat: z.number(), lng: z.number(), arrivedAt: z.coerce.date().nullable(), completedAt: z.coerce.date().nullable() })),
    }),
  ),
  marks: z.array(z.object({ id: z.string(), type: z.string(), at: z.coerce.date(), lat: z.number().nullable(), lng: z.number().nullable() })),
  /** The trips are older than the trail's 30 days: the path itself is gone, the marks stay. */
  trailPurged: z.boolean(),
});
export type OrderReplay = z.infer<typeof OrderReplay>;

/**
 * An order predicted to arrive late before it is (maps program o4): his live ETA against what the
 * customer was promised.
 */
export const AT_RISK_RULES = {
  /** Predicted arrival later than the promise by more than this is at risk. */
  marginMin: 2,
  /** One prediction per order is reused this long (every Console tab polls). */
  cacheMs: 30_000,
} as const;

export const AtRiskOrder = z.object({
  orderId: z.string(),
  predictedAt: z.coerce.date(),
  promisedAt: z.coerce.date(),
  /** Minutes the prediction is past the promise. */
  lateByMin: z.number().int().min(1),
});
export type AtRiskOrder = z.infer<typeof AtRiskOrder>;
export const AtRiskInput = z.object({ cityId: CityId });

/** What the API's `console` module exposes to the transport. Authorization happens in the routers. */
export interface ConsolePort {
  /** Batched display names (vault reads logged against `accessorId`, the staff member asking). */
  names(input: z.infer<typeof ConsoleNamesInput>, accessorId: string): Promise<ConsoleNames>;
  driverPositions(cityId: string): Promise<DriverPositions>;
  /** `accessorId` (the staff member) is logged for the vault reads of a name search. */
  driversList(input: z.infer<typeof DriversListInput>, accessorId?: string): Promise<DriversPage>;
  searchOrders(input: z.infer<typeof OrderSearchInput>): Promise<OrderSearchPage>;
  orderEvents(orderId: string): Promise<EventLogEntry[]>;
  /** Every ledger line carrying this order id, in time order (the money story on the order page). */
  orderLedger(orderId: string): Promise<OrderLedgerLine[]>;
  tripEvents(tripId: string): Promise<EventLogEntry[]>;
  /** The order's courier path and its moments (maps program o2). */
  orderReplay(orderId: string): Promise<OrderReplay>;
  rightNow(cityId: string): Promise<RightNow>;
  outbox(): Promise<OutboxView>;
  merchants(cityId: string): Promise<MerchantRow[]>;
  simulatorStatus(): Promise<z.input<typeof SimulatorStatus>>;
  simulatorStart(input: z.infer<typeof SimulatorStartInput>): Promise<z.input<typeof SimulatorStatus>>;
  simulatorStop(): Promise<z.input<typeof SimulatorStatus>>;
}
