import { z } from 'zod';
import { Iqd } from './common.js';
import { DayHours, HhMm, HolidayClosure, LocalDate } from './store-hours.js';
import type { Actor } from './identity-io.js';
import { OrderState, OrderType, PaymentMethod } from './order.js';
import { VehicleClass } from './trip.js';

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

export const BoardCourier = z.object({
  state: BoardCourierState,
  firstName: z.string().nullable(),
  vehicleClass: VehicleClass.nullable(),
  /** Minutes to the counter while `on_the_way` (from his last fix at town speed). */
  etaMinutes: z.number().int().nullable(),
  /** When he reached the counter (`arrived`): the kitchen sees how long he has waited. */
  arrivedAt: z.coerce.date().nullable(),
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
  /** Order-level note from the customer. */
  note: z.string().nullable(),
  /** Partial accept waiting for the customer (review A.4). */
  partial: z.object({ unavailableLineIds: z.array(z.string()), deadline: z.coerce.date() }).nullable(),
  courier: BoardCourier,
  /** Past the promised ready time (preparing) — the card turns warning. */
  late: z.boolean(),
  catering: z.boolean(),
});
export type BoardOrder = z.infer<typeof BoardOrder>;

export const MerchantBoard = z.object({
  merchantOrgId: z.string(),
  /** Server time, so card timers don't drift with the tablet's clock. */
  now: z.coerce.date(),
  acceptWindowSec: z.number().int(),
  orders: z.array(BoardOrder),
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
  closed: z.object({ reason: EarlyCloseReason, note: z.string().nullable(), at: z.coerce.date() }).nullable(),
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
});
export type StoreStatusView = z.infer<typeof StoreStatusView>;

export const SetStoreOpenInput = MerchantOrgInput.extend({
  open: z.boolean(),
  /** Required when closing. */
  reason: EarlyCloseReason.optional(),
  note: z.string().trim().max(200).optional(),
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
}
