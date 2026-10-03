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
  /** Matches order, orderer or merchant id, or the note (case-insensitive substring). */
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

/** Kept stable while the simulator is rebuilt: `available: false` until it is wired. */
export const SimulatorStatus = z.object({
  available: z.boolean(),
  running: z.boolean().default(false),
  startedAt: z.coerce.date().nullable().default(null),
  drivers: z.number().int().nonnegative().default(0),
  ordersPerHour: z.number().int().nonnegative().default(0),
});
export type SimulatorStatus = z.infer<typeof SimulatorStatus>;

export const SimulatorStartInput = z.object({
  cityId: CityId,
  drivers: z.number().int().min(1).max(500).default(20),
  ordersPerHour: z.number().int().min(1).max(5000).default(60),
  seed: z.number().int().optional(),
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

// ───────────────────────── the port ─────────────────────────

/** What the API's `console` module exposes to the transport. Authorization happens in the routers. */
export interface ConsolePort {
  driverPositions(cityId: string): Promise<DriverPositions>;
  driversList(input: z.infer<typeof DriversListInput>): Promise<DriversPage>;
  searchOrders(input: z.infer<typeof OrderSearchInput>): Promise<OrderSearchPage>;
  orderEvents(orderId: string): Promise<EventLogEntry[]>;
  tripEvents(tripId: string): Promise<EventLogEntry[]>;
  rightNow(cityId: string): Promise<RightNow>;
  outbox(): Promise<OutboxView>;
  merchants(cityId: string): Promise<MerchantRow[]>;
  simulatorStatus(): Promise<z.input<typeof SimulatorStatus>>;
  simulatorStart(input: z.infer<typeof SimulatorStartInput>): Promise<z.input<typeof SimulatorStatus>>;
  simulatorStop(): Promise<z.input<typeof SimulatorStatus>>;
}
