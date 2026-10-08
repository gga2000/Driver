import { z } from 'zod';
import type { RoleKind } from './auth.js';
import { ZoneTier } from './city-config.js';
import { Iqd, LatLng } from './common.js';
import { DayHours, HhMm, HolidayClosure, LocalDate } from './store-hours.js';
import type { Actor } from './identity-io.js';
import { OrderState, OrderType, PaymentMethod } from './order.js';
import { VehicleClass } from './trip.js';
import { ZonePlacement } from './zones-io.js';

/**
 * Driver Merchant (restaurants and grocers) — the kitchen side: which stores a person works at, the
 * live orders board, and the store's status header (open/closed, busy mode, printer, heartbeat).
 * Order actions themselves stay on `orders.merchant.*`; money on `ledger.merchantBalance` /
 * `ledger.requestSettlement`. Implemented by the API's `merchant` module behind `ctx.merchant`.
 */

/** Busy mode (spec "Driver Merchant"): +10 min on every prep time, switches itself off after an hour. */
export const MERCHANT_BUSY_RULES = { extraPrepMinutes: 10, durationMinutes: 60 } as const;

/** What a person is at a store: the owner (money, staff) or staff (orders, menu). */
export const MerchantStoreRole = z.enum(['owner', 'staff']);
export type MerchantStoreRole = z.infer<typeof MerchantStoreRole>;

export const MerchantStore = z.object({
  orgId: z.string(),
  name: z.string(),
  type: z.enum(['restaurant', 'grocer']),
  cityId: z.string(),
  role: MerchantStoreRole,
});
export type MerchantStore = z.infer<typeof MerchantStore>;

export const MerchantOrgInput = z.object({ merchantOrgId: z.string().min(1) });
export type MerchantOrgInput = z.infer<typeof MerchantOrgInput>;

// ───────────────────────── board ─────────────────────────

/** Board columns: جديد (placed, waiting for the kitchen) · يتحضّر (accepted/preparing) · جاهز. */
export const BoardColumn = z.enum(['new', 'preparing', 'ready']);
export type BoardColumn = z.infer<typeof BoardColumn>;

/**
 * Where the courier is for this order, as the kitchen needs it: nobody yet (`searching`), on his way
 * to the counter (`on_the_way`, with minutes), at the counter (`arrived`), or gone with it.
 */
export const BoardCourierState = z.enum(['none', 'searching', 'on_the_way', 'arrived', 'picked_up']);
export type BoardCourierState = z.infer<typeof BoardCourierState>;

export const BoardLine = z.object({
  lineId: z.string(),
  name: z.string(),
  qty: z.number().int(),
  /** Chosen modifiers by name ("صمون", "حار"). */
  modifiers: z.array(z.string()),
  /** The customer's note on this line; printed in bold. */
  note: z.string().nullable(),
  unitPriceIqd: Iqd,
  totalIqd: Iqd,
  availability: z.enum(['available', 'unavailable', 'removed']),
});
export type BoardLine = z.infer<typeof BoardLine>;

/**
 * Items grouped by the person they are for (order-for-others tagging, domain §3). The orderer's own
 * lines have `kind: 'orderer'` and no label (the app says "صاحب الطلب"); everyone else carries the
 * label the orderer typed ("أبو حسين", "الصغير"). Customer names are never read from the vault here.
 */
export const BoardGroup = z.object({
  key: z.string(),
  kind: z.enum(['orderer', 'participant']),
  label: z.string().nullable(),
  note: z.string().nullable(),
  itemCount: z.number().int(),
  lines: z.array(BoardLine),
});
export type BoardGroup = z.infer<typeof BoardGroup>;

/** The courier radar around the kitchen (maps program SP7a, r1/r2): "about to walk in" inside this. */
export const RADAR_NEAR_M = 250;
/** The radar's rings, metres from the kitchen. */
export const RADAR_RINGS_M = [250, 1_000, 3_000] as const;

export const BoardCourier = z.object({
  state: BoardCourierState,
  firstName: z.string().nullable(),
  vehicleClass: VehicleClass.nullable(),
  /** Minutes to the counter while `on_the_way` (the one ETA, from his last fix). */
  etaMinutes: z.number().int().nullable(),
  /** When he reached the counter (`arrived`): the kitchen sees how long he has waited. */
  arrivedAt: z.coerce.date().nullable(),
  /** Straight-line metres from the kitchen while `on_the_way` (the radar); never his coordinates. */
  distanceM: z.number().int().min(0).nullable().optional(),
  /** Degrees clockwise from north, kitchen → courier, while `on_the_way`. */
  bearingDeg: z.number().min(0).max(360).nullable().optional(),
  /** His plate ("واسط 45678") so the counter can tell couriers apart; null when unknown. */
  plate: z.string().nullable().optional(),
  /**
   * The 4-digit code on the courier's screen (maps program r4) while he is coming or at the counter:
   * the kitchen hands the food to the courier whose code matches.
   */
  pickupCode: z.string().nullable().optional(),
});
export type BoardCourier = z.infer<typeof BoardCourier>;

export const BoardOrder = z.object({
  id: z.string(),
  /** Short ticket number the kitchen calls out ("4821"); stable per order. */
  number: z.string(),
  column: BoardColumn,
  state: OrderState,
  type: OrderType,
  placedAt: z.coerce.date(),
  offeredAt: z.coerce.date().nullable(),
  /** End of the 90-s acceptance window (new orders only; null for auto-accepted or not yet offered). */
  acceptBy: z.coerce.date().nullable(),
  acceptedAt: z.coerce.date().nullable(),
  promisedReadyAt: z.coerce.date().nullable(),
  readyAt: z.coerce.date().nullable(),
  scheduledFor: z.coerce.date().nullable(),
  /** The prep time the kitchen committed to (busy minutes included). */
  prepMinutes: z.number().int().nullable(),
  paymentMethod: PaymentMethod,
  itemsTotalIqd: Iqd,
  totalIqd: Iqd,
  /** Cash the courier collects at the door (cash orders); 0 when prepaid. */
  collectCashIqd: Iqd,
  itemCount: z.number().int(),
  groups: z.array(BoardGroup),
  /** Order-level note from the customer for the kitchen (the card shows it). */
  note: z.string().nullable(),
  /** The customer's note for the courier (M-09): the detail sheet shows it, the kitchen card does not. */
  courierNote: z.string().nullable().optional(),
  /** Partial accept waiting for the customer (review A.4). */
  partial: z.object({ unavailableLineIds: z.array(z.string()), deadline: z.coerce.date() }).nullable(),
  courier: BoardCourier,
  /** Past the promised ready time (preparing) — the card turns warning. */
  late: z.boolean(),
  catering: z.boolean(),
  /** The kitchen already used its one "+5 د" on this order (MERCHANT_PREP_EXTENSION). */
  prepExtended: z.boolean().optional(),
  /** S-M4: when the kitchen tapped "سلّمته" (handed the bag to the courier at the pass); null = not yet. */
  handedOverAt: z.coerce.date().nullable().optional(),
  /** «عزيمة» (joy g1): a gift; `hidePrices` → the ticket prints no amounts. Null/absent = not a gift. */
  gift: z.object({ hidePrices: z.boolean() }).nullable().optional(),
});
export type BoardOrder = z.infer<typeof BoardOrder>;

/**
 * Why an order left the board without the kitchen answering it (M-01): nobody accepted within the
 * 90 s (`merchant_timeout`, auto-rejected), or the customer let a partial accept lapse
 * (`partial_timeout`). Both cancel the order for the customer, who sees it on the live screen.
 */
export const MissedReason = z.enum(['merchant_timeout', 'partial_timeout']);
export type MissedReason = z.infer<typeof MissedReason>;

export const MissedOrder = z.object({
  orderId: z.string(),
  number: z.string(),
  reason: MissedReason,
  placedAt: z.coerce.date(),
  missedAt: z.coerce.date(),
  itemCount: z.number().int(),
  totalIqd: Iqd,
  /** False when the miss fell inside a declared pause window (prayer, holiday): it does not count against the store. */
  scored: z.boolean(),
});
export type MissedOrder = z.infer<typeof MissedOrder>;

/** Today's misses (Baghdad day), newest first; the board keeps them visible until the kitchen taps "تمام". */
export const MissedSummary = z.object({
  today: z.number().int(),
  orders: z.array(MissedOrder),
});
export type MissedSummary = z.infer<typeof MissedSummary>;

export const MerchantBoard = z.object({
  merchantOrgId: z.string(),
  /** Server time, so card timers don't drift with the tablet's clock. */
  now: z.coerce.date(),
  acceptWindowSec: z.number().int(),
  orders: z.array(BoardOrder),
  /** Orders missed today (M-01): they never vanish silently. */
  missed: MissedSummary.optional(),
});
export type MerchantBoard = z.infer<typeof MerchantBoard>;

// ───────────────────────── store status ─────────────────────────

/** Why the store closed early (edge-case decisions: "early-close reason"). */
export const EarlyCloseReason = z.enum(['sold_out', 'too_busy', 'no_staff', 'power_cut', 'closing_early', 'other']);
export type EarlyCloseReason = z.infer<typeof EarlyCloseReason>;

export const PrinterState = z.enum(['connected', 'disconnected', 'not_set_up']);
export type PrinterState = z.infer<typeof PrinterState>;

export const StoreStatusView = z.object({
  merchantOrgId: z.string(),
  name: z.string(),
  now: z.coerce.date(),
  /** Taking orders right now: not closed by hand and not inside a pause window. */
  open: z.boolean(),
  /** Closed by hand from the app, with the reason. */
  closed: z
    .object({
      reason: EarlyCloseReason,
      note: z.string().nullable(),
      at: z.coerce.date(),
      /** A quick pause reopens by itself at this time (counter step 5, h2); null = until reopened by hand. */
      until: z.coerce.date().nullable().optional(),
    })
    .nullable(),
  /** A scheduled pause window in force (Friday prayer): orders resume by themselves at `until` ("13:15"). */
  pause: z.object({ reason: z.string().nullable(), until: z.string() }).nullable(),
  busy: z.object({
    on: z.boolean(),
    until: z.coerce.date().nullable(),
    extraPrepMinutes: z.number().int(),
  }),
  printer: z.object({ state: PrinterState, name: z.string().nullable(), updatedAt: z.coerce.date().nullable() }),
  lastHeartbeatAt: z.coerce.date().nullable(),
  defaultPrepMinutes: z.number().int(),
  /**
   * The weekly schedule and holiday closures (`merchant.hours`) at `now`; additive. `open` above
   * stays the switch + pause state, so the board explains "برّا الدوام" separately.
   */
  schedule: z
    .object({
      inHours: z.boolean(),
      holiday: z.object({ to: LocalDate, note: z.string().nullable() }).nullable(),
      closesAt: HhMm.nullable(),
      opensAt: z
        .object({ date: LocalDate, dow: z.number().int().min(0).max(6), time: HhMm })
        .nullable(),
    })
    .nullable()
    .optional(),
  /**
   * «جهّز محلك» (merchant setup): only for shops that went through setup. Before the shutter goes up
   * the shop takes no orders (`live: false`); after it, the first real order wears the gold ribbon
   * until the owner has seen it through. Absent/null: an older shop, nothing changes for it.
   */
  setup: z
    .object({
      live: z.boolean(),
      percent: z.number().int().min(0).max(100),
      left: z.number().int().min(0),
      firstOrderId: z.string().nullable(),
    })
    .nullable()
    .optional(),
});
export type StoreStatusView = z.infer<typeof StoreStatusView>;

/** Quick pauses from «المحل» (counter step 5, h2): from 5 minutes to a day and a half. */
export const STORE_PAUSE_RULES = { minMinutes: 5, maxMinutes: 36 * 60 } as const;

export const SetStoreOpenInput = MerchantOrgInput.extend({
  open: z.boolean(),
  /** Required when closing. */
  reason: EarlyCloseReason.optional(),
  note: z.string().trim().max(200).optional(),
  /** Closing for a while: the store reopens by itself this many minutes from now (no reopen by hand needed). */
  pauseMinutes: z.number().int().min(STORE_PAUSE_RULES.minMinutes).max(STORE_PAUSE_RULES.maxMinutes).optional(),
}).refine((v) => v.open || v.reason !== undefined, { message: 'closing needs a reason', path: ['reason'] });
export type SetStoreOpenInput = z.infer<typeof SetStoreOpenInput>;

export const SetBusyInput = MerchantOrgInput.extend({ on: z.boolean() });
export type SetBusyInput = z.infer<typeof SetBusyInput>;

export const SetPrinterStatusInput = MerchantOrgInput.extend({
  state: z.enum(['connected', 'disconnected']),
  name: z.string().trim().max(60).optional(),
});
export type SetPrinterStatusInput = z.infer<typeof SetPrinterStatusInput>;

// ───────────────────────── opening hours ─────────────────────────

/** A pause window from the city (Friday prayer) or the store, shown on the hours screen. */
export const StorePauseView = z.object({
  dow: z.number().int().min(0).max(6),
  start: HhMm,
  end: HhMm,
  reason: z.string().nullable(),
});
export type StorePauseView = z.infer<typeof StorePauseView>;

export const StoreHoursView = z.object({
  merchantOrgId: z.string(),
  timeZone: z.string(),
  /** `store`: set from the Merchant app; `catalog`: the onboarding seed; `none`: no hours on file (always open). */
  source: z.enum(['store', 'catalog', 'none']),
  /** Seven days, Sunday first; a day without shifts is closed. */
  days: z.array(DayHours).length(7),
  /** Current and upcoming closures, soonest first (past ones are dropped on read). */
  holidays: z.array(HolidayClosure),
  /** Orders pause here regardless of the schedule (Friday prayer). */
  pauses: z.array(StorePauseView),
  now: z.coerce.date(),
  /** Local date at `now`. */
  today: LocalDate,
  state: z.object({
    open: z.boolean(),
    /** Why it is closed now: outside the schedule, a holiday, a pause window, or closed by hand. */
    reason: z.enum(['hours', 'holiday', 'pause', 'closed']).nullable(),
    closesAt: HhMm.nullable(),
    opensAt: z
      .object({ date: LocalDate, dow: z.number().int().min(0).max(6), time: HhMm })
      .nullable(),
  }),
  /** Owners edit; staff read. */
  canEdit: z.boolean(),
  updatedAt: z.coerce.date().nullable(),
});
export type StoreHoursView = z.infer<typeof StoreHoursView>;

/** Replaces the whole schedule (validated with `storeHoursProblems`: `store_hours_invalid`). Owner only. */
export const SetStoreHoursInput = MerchantOrgInput.extend({
  days: z.array(DayHours).length(7),
  holidays: z.array(HolidayClosure).max(20),
});
export type SetStoreHoursInput = z.infer<typeof SetStoreHoursInput>;

// ───────────────────────── pickup spot ─────────────────────────

/**
 * Where couriers collect orders (maps program r7): a couple of photos («الشباك اليسار», the side door)
 * and one short line. Two photos are enough to show the door and the counter behind it; the note is a
 * glance on the courier's job card, not a paragraph.
 */
export const PICKUP_SPOT_RULES = { maxPhotos: 2, noteMaxChars: 140 } as const;

/** A pickup-spot photo: upload id (stable across saves) and a short-lived signed link to show it. */
export const PickupSpotPhoto = z.object({ id: z.string(), url: z.string() });
export type PickupSpotPhoto = z.infer<typeof PickupSpotPhoto>;

/** The store's pickup spot as its owner and staff see it on «مكان الاستلام». */
export const PickupSpotView = z.object({
  merchantOrgId: z.string(),
  note: z.string().nullable(),
  photos: z.array(PickupSpotPhoto).max(PICKUP_SPOT_RULES.maxPhotos),
  /** Owners edit; staff read. */
  canEdit: z.boolean(),
  updatedAt: z.coerce.date().nullable(),
});
export type PickupSpotView = z.infer<typeof PickupSpotView>;

/**
 * Owner only. Replaces the spot: `photoIds` lists every photo to keep, in order — ids already on the
 * spot stay, new ones must be the caller's own stored uploads (`places.photoUpload`), and photos left
 * out are deleted. An empty note and no photos clears it.
 */
export const SetPickupSpotInput = MerchantOrgInput.extend({
  note: z.string().trim().max(PICKUP_SPOT_RULES.noteMaxChars).nullable(),
  photoIds: z
    .array(z.string().min(1))
    .max(PICKUP_SPOT_RULES.maxPhotos)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'a photo appears twice' }),
});
export type SetPickupSpotInput = z.infer<typeof SetPickupSpotInput>;

// ───────────────────────── pickup spot from the Console (Ali 2026-10-07) ─────────────────────────

/**
 * Who sets a store's pickup spot from the Console (`ops.pickupSpots.*`): field ops, who stand at the
 * window when they visit, and admins. Not support: it changes what every courier is told.
 */
export const PICKUP_SPOT_CONSOLE_ROLES: readonly RoleKind[] = ['field_ops', 'admin'];

export const PickupStoresInput = z.object({ cityId: z.string().min(1) });
export type PickupStoresInput = z.infer<typeof PickupStoresInput>;

/** One store on Console › المطاعم: its name and how its pickup spot stands (no links: the list loads no photos). */
export const PickupStoreRow = z.object({
  merchantOrgId: z.string(),
  name: z.string(),
  type: z.enum(['restaurant', 'grocer']),
  note: z.string().nullable(),
  photos: z.number().int().min(0).max(PICKUP_SPOT_RULES.maxPhotos),
  updatedAt: z.coerce.date().nullable(),
});
export type PickupStoreRow = z.infer<typeof PickupStoreRow>;

/**
 * A store's pickup spot as the Console edits it: the owner's view (`canEdit` is true) with the store's
 * name, and the latest Console change from the audit log — null when the owner saved it last or
 * nobody ever set it, so the page can say who the couriers are hearing from.
 */
export const ConsolePickupSpotView = PickupSpotView.extend({
  storeName: z.string(),
  consoleEdit: z.object({ at: z.coerce.date(), byName: z.string().nullable() }).nullable(),
});
export type ConsolePickupSpotView = z.infer<typeof ConsolePickupSpotView>;

/** What the API supplies to `ops.pickupSpots.*` (implemented in `modules/ops` over the merchant module). */
export interface PickupSpotsOpsPort {
  stores(actor: Actor, input: PickupStoresInput): Promise<PickupStoreRow[]>;
  get(actor: Actor, input: MerchantOrgInput): Promise<ConsolePickupSpotView>;
  /** Same rules as the owner's save (photos the caller uploaded, 2 at most, 140 characters); audited. */
  set(actor: Actor, input: SetPickupSpotInput): Promise<ConsolePickupSpotView>;
}

// ───────────────────────── delivery area and fees (maps program r5) ─────────────────────────

/**
 * How long the API keeps a store's delivery-area view. Zones and fee rules change rarely (a Console
 * edit, Ali's money rules), and the fee also moves with the hour (night fee), so the cache is also
 * keyed by the Baghdad hour: a cached fee never outlives the hour it was priced in.
 */
export const DELIVERY_AREA_CACHE_MS = 3 * 60_000;

/**
 * Whether customers in a zone can order from this kitchen right now: `open`; `paused` when a Console
 * switch stops food there (the zone, the whole food service, or this store); `no_price` when the
 * pricing engine could not price the pair (checkout would refuse it the same way).
 */
export const DeliveryZoneService = z.enum(['open', 'paused', 'no_price']);
export type DeliveryZoneService = z.infer<typeof DeliveryZoneService>;

/** One zone on the restaurant's delivery map: its outline and what the customer pays from this kitchen. */
export const DeliveryAreaZone = z.object({
  key: z.string(),
  name_ar: z.string(),
  name_en: z.string(),
  tier: ZoneTier,
  placement: ZonePlacement,
  /** Open ring; fewer than 3 points means no outline yet (the app draws a dot at `centre`). */
  ring: z.array(LatLng),
  centre: LatLng,
  /** The delivery fee a customer here pays for this kitchen's food (server quote, door delivery); null when not priced. */
  feeIqd: Iqd.nullable(),
  /** Index into `bands` (cheapest first); null when not priced. */
  band: z.number().int().nonnegative().nullable(),
  service: DeliveryZoneService,
  /** The kitchen stands in this zone. */
  kitchen: z.boolean(),
});
export type DeliveryAreaZone = z.infer<typeof DeliveryAreaZone>;

/** One fee amount on the legend and how many zones pay it. */
export const DeliveryFeeBand = z.object({ feeIqd: Iqd, zones: z.number().int().positive() });
export type DeliveryFeeBand = z.infer<typeof DeliveryFeeBand>;

/** «منطقة التوصيل»: read-only; every amount is the server's (the app never prices). */
export const MerchantDeliveryArea = z.object({
  merchantOrgId: z.string(),
  cityId: z.string(),
  /** Where the kitchen is; null when the store has no place on file yet (then nothing is priced). */
  kitchen: z
    .object({
      zoneKey: z.string(),
      name_ar: z.string(),
      name_en: z.string(),
      pin: LatLng.nullable(),
    })
    .nullable(),
  zones: z.array(DeliveryAreaZone),
  /** Distinct fees, cheapest first: the map's colours and the legend. */
  bands: z.array(DeliveryFeeBand),
  /** When the fees were quoted (night fees depend on the hour). */
  pricedAt: z.coerce.date(),
});
export type MerchantDeliveryArea = z.infer<typeof MerchantDeliveryArea>;

/**
 * The legend's bands from the zones' fees: one per distinct amount, cheapest first, with how many
 * zones pay it. Unpriced zones (null) are left out. Shared so the API and its tests agree.
 */
export function feeBandsOf(fees: ReadonlyArray<number | null>): DeliveryFeeBand[] {
  const counts = new Map<number, number>();
  for (const fee of fees) if (fee !== null) counts.set(fee, (counts.get(fee) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([feeIqd, zones]) => ({ feeIqd, zones }));
}

// ───────────────────────── where my customers are (maps program r6) ─────────────────────────

/**
 * Privacy (maps spec D7): a zone with fewer delivered orders than this in the window is not named; its
 * orders join «مناطق ثانية». Restaurants see areas only, never a pin, an address or a customer.
 */
export const CUSTOMER_ZONE_MIN_ORDERS = 5;
/** The window the spec asks for (last 30 days); the insights screen passes its own range (up to 90). */
export const CUSTOMER_ZONES_DEFAULT_DAYS = 30;

export const CustomerZonesInput = MerchantOrgInput.extend({ days: z.number().int().min(1).max(90).default(CUSTOMER_ZONES_DEFAULT_DAYS) });
export type CustomerZonesInput = z.input<typeof CustomerZonesInput>;

/** A zone that passed the threshold, with its delivered orders. */
export const CustomerZoneCount = z.object({ key: z.string(), name_ar: z.string(), name_en: z.string(), orders: z.number().int().positive() });
export type CustomerZoneCount = z.infer<typeof CustomerZoneCount>;

export const MerchantCustomerZones = z.object({
  merchantOrgId: z.string(),
  from: z.coerce.date(),
  to: z.coerce.date(),
  days: z.number().int().positive(),
  /** The threshold in force (CUSTOMER_ZONE_MIN_ORDERS), so the app's copy says the same number. */
  minOrders: z.number().int().positive(),
  /** Zones with at least `minOrders` delivered orders, most first. */
  zones: z.array(CustomerZoneCount),
  /** Delivered orders in zones under the threshold (or with no zone on file), summed. */
  otherOrders: z.number().int().nonnegative(),
  totalOrders: z.number().int().nonnegative(),
});
export type MerchantCustomerZones = z.infer<typeof MerchantCustomerZones>;

/** What the API supplies to the `merchant` router (implemented by `modules/merchant`). */
export interface MerchantPort {
  /** Stores the actor works at (owner or staff); empty when the account isn't activated for any. */
  myStores(actor: Actor): Promise<MerchantStore[]>;
  board(actor: Actor, input: MerchantOrgInput): Promise<MerchantBoard>;
  storeStatus(actor: Actor, input: MerchantOrgInput): Promise<StoreStatusView>;
  setOpen(actor: Actor, input: SetStoreOpenInput): Promise<StoreStatusView>;
  setBusy(actor: Actor, input: SetBusyInput): Promise<StoreStatusView>;
  setPrinterStatus(actor: Actor, input: SetPrinterStatusInput): Promise<StoreStatusView>;
  hours(actor: Actor, input: MerchantOrgInput): Promise<StoreHoursView>;
  setHours(actor: Actor, input: SetStoreHoursInput): Promise<StoreHoursView>;
  pickupSpot(actor: Actor, input: MerchantOrgInput): Promise<PickupSpotView>;
  setPickupSpot(actor: Actor, input: SetPickupSpotInput): Promise<PickupSpotView>;
  /** The store's delivery zones with the server's fee from this kitchen to each (maps program r5). */
  deliveryArea(actor: Actor, input: MerchantOrgInput): Promise<MerchantDeliveryArea>;
  /** Delivered orders per drop-off zone over the window, small zones hidden (maps program r6, D7). */
  customerZones(actor: Actor, input: z.output<typeof CustomerZonesInput>): Promise<MerchantCustomerZones>;
}
