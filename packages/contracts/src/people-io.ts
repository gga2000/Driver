import { z } from 'zod';
import type { Actor } from './identity-io.js';
import type { RoleKind } from './auth.js';
import { CityId, Iqd } from './common.js';
import { OrderState, OrderType } from './order.js';
import { OrderSummary, DriverPinState } from './console-io.js';
import { CapRole, CapTier } from './ledger-rules.js';
import { DriverDocumentKind, DriverDocumentStatus, ScoreMetricKey } from './driver-account-io.js';
import { TicketKind, TicketStatus } from './support-io.js';

/**
 * «الناس» in the Console (Ali, 2026-10-21): every customer and every driver (couriers, taxi and
 * tuktuk, الرجعة, خطوط) with a profile, analytics, a timeline and support actions. Pseudonymous by
 * default: a profile carries the display name and a masked number (one logged vault read); the
 * whole number is a separate, purpose-logged reveal. Console-only schemas: `@driver/contracts/people`.
 */

/** Who reads profiles and lists (the Console's read roles). */
export const PEOPLE_READ_ROLES: readonly RoleKind[] = ['dispatcher', 'support', 'finance', 'admin'];
/** Who may reveal a whole phone number (the desks that call people). */
export const PHONE_REVEAL_ROLES: readonly RoleKind[] = ['support', 'dispatcher', 'admin'];

/** How far back the list's numbers and segments look. */
export const PEOPLE_WINDOW_DAYS = 90;

// ───────────────────────── customers list ─────────────────────────

/**
 * One label per customer, the first that fits: frozen, an open ticket, joined in the last 14 days,
 * regular (4+ delivered in 30 days), active (ordered in 30 days), lapsed (last order 31–90 days
 * ago), quiet (nothing in 90 days).
 */
export const CustomerSegment = z.enum([
  'frozen',
  'issue',
  'new',
  'regular',
  'active',
  'lapsed',
  'quiet',
]);
export type CustomerSegment = z.infer<typeof CustomerSegment>;
export const CustomerFilter = z.enum(['all', 'new', 'regular', 'lapsed', 'issue', 'frozen']);
export type CustomerFilter = z.infer<typeof CustomerFilter>;

export const PeopleCustomersInput = z.object({
  cityId: CityId,
  filter: CustomerFilter.default('all'),
  /** A name, the last four digits of the number, or a person id. */
  q: z.string().trim().max(60).optional(),
  cursor: z.string().max(60).optional(),
  limit: z.number().int().min(1).max(100).default(40),
});
export type PeopleCustomersInput = z.input<typeof PeopleCustomersInput>;

export const CustomerRow = z.object({
  personId: z.string(),
  segment: CustomerSegment,
  frozen: z.boolean(),
  joinedAt: z.coerce.date(),
  /** In the window (`PEOPLE_WINDOW_DAYS`). */
  orders: z.number().int().nonnegative(),
  delivered: z.number().int().nonnegative(),
  spentIqd: Iqd,
  lastOrderAt: z.coerce.date().nullable(),
  /** Orders per week, the last 8 Sunday-start weeks (Baghdad), oldest first. */
  weekly: z.array(z.number().int().nonnegative()),
  /** The drop-off zone they order to most. */
  zoneKey: z.string().nullable(),
  openTickets: z.number().int().nonnegative(),
});
export type CustomerRow = z.infer<typeof CustomerRow>;

export const CustomersPage = z.object({
  rows: z.array(CustomerRow),
  nextCursor: z.string().nullable(),
  /** Matches of the filter and search. */
  total: z.number().int().nonnegative(),
  /** People in each filter (before the search). */
  counts: z.record(CustomerFilter, z.number().int().nonnegative()),
  /** Ordered in the last 30 days, and last month's same count (the tile's comparison). */
  active30d: z.number().int().nonnegative(),
  activePrev30d: z.number().int().nonnegative(),
  windowFrom: z.coerce.date(),
});
export type CustomersPage = z.infer<typeof CustomersPage>;

// ───────────────────────── one customer ─────────────────────────

export const PersonInput = z.object({ cityId: CityId, personId: z.string().min(1).max(60) });
export type PersonInput = z.input<typeof PersonInput>;

/** Short facts the profile writes as sentences (the Console words them; numbers ride along). */
export const ProfileSignal = z.object({
  key: z.enum([
    'late_orders',
    'credits',
    'cancels_high',
    'rates_well',
    'rates_low',
    'peak_hour',
    'open_ticket',
    'lapsed',
    'new_customer',
    'frozen',
  ]),
  tone: z.enum(['good', 'warn', 'bad', 'info']),
  n: z.number().int().nullable().default(null),
  iqd: Iqd.nullable().default(null),
});
export type ProfileSignal = z.infer<typeof ProfileSignal>;

export const ProfileTicket = z.object({
  id: z.string(),
  subject: z.string(),
  kind: TicketKind,
  status: TicketStatus,
  openedAt: z.coerce.date(),
  orderId: z.string().nullable(),
  refundedIqd: Iqd,
});
export type ProfileTicket = z.infer<typeof ProfileTicket>;

export const CustomerProfile = z.object({
  personId: z.string(),
  /** Display name and «0770 ••• 4567», one logged read; null for a deleted person. */
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  joinedAt: z.coerce.date(),
  frozen: z.boolean(),
  trustTier: z.string(),
  lastActiveAt: z.coerce.date().nullable(),
  segment: CustomerSegment,
  totals: z.object({
    orders: z.number().int().nonnegative(),
    delivered: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    /** Taxi and tuktuk rides among `orders`. */
    rides: z.number().int().nonnegative(),
    spentIqd: Iqd,
    /** Average delivered order (rides excluded); null without one. */
    avgOrderIqd: Iqd.nullable(),
    /** The city's average delivered order over the window, for comparison. */
    cityAvgOrderIqd: Iqd.nullable(),
    firstOrderAt: z.coerce.date().nullable(),
    lastOrderAt: z.coerce.date().nullable(),
    /** Median days between orders; null under three orders. */
    everyDays: z.number().nullable(),
  }),
  payment: z.object({ cash: z.number().int(), wallet: z.number().int(), other: z.number().int() }),
  /** Orders per Sunday-start week (Baghdad), the last 12, oldest first; the last is this week so far. */
  weekly: z.array(z.number().int().nonnegative()),
  /** Orders by Baghdad hour of the day, 0–23, over all time. */
  hours: z.array(z.number().int().nonnegative()),
  services: z.array(z.object({ type: OrderType, count: z.number().int() })),
  topMerchants: z.array(z.object({ orgId: z.string(), count: z.number().int() })),
  /** Orders and rides going on right now. */
  live: z.array(OrderSummary),
  recent: z.array(OrderSummary),
  credits30dIqd: Iqd,
  /** Their delivery ratings given to couriers. */
  ratingAvg: z.number().nullable(),
  ratingCount: z.number().int().nonnegative(),
  tickets: z.object({
    open: z.number().int(),
    total: z.number().int(),
    recent: z.array(ProfileTicket),
  }),
  signals: z.array(ProfileSignal),
});
export type CustomerProfile = z.infer<typeof CustomerProfile>;

// ───────────────────────── the story (timeline) ─────────────────────────

export const StoryInput = z.object({
  cityId: CityId,
  personId: z.string().min(1).max(60),
  who: z.enum(['customer', 'driver']),
  kinds: z
    .array(z.enum(['order', 'money', 'ticket', 'rating']))
    .max(4)
    .optional(),
  /** Older than this (the previous page's `nextBefore`). */
  before: z.coerce.date().optional(),
  limit: z.number().int().min(1).max(100).default(40),
});
export type StoryInput = z.input<typeof StoryInput>;

export const StoryItem = z.object({
  id: z.string(),
  at: z.coerce.date(),
  kind: z.enum(['order', 'money', 'ticket', 'rating']),
  orderId: z.string().nullable().default(null),
  orderType: OrderType.nullable().default(null),
  state: OrderState.nullable().default(null),
  merchantOrgId: z.string().nullable().default(null),
  /** Order total, a credit, a driver's net for the job. */
  amountIqd: Iqd.nullable().default(null),
  /** Ledger line label (money), ticket subject (ticket). */
  label: z.string().nullable().default(null),
  ticketId: z.string().nullable().default(null),
  ticketStatus: TicketStatus.nullable().default(null),
  score: z.number().int().min(1).max(5).nullable().default(null),
});
export type StoryItem = z.infer<typeof StoryItem>;

export const StoryPage = z.object({
  items: z.array(StoryItem),
  nextBefore: z.coerce.date().nullable(),
});
export type StoryPage = z.infer<typeof StoryPage>;

// ───────────────────────── one driver ─────────────────────────

export const DriverPeopleProfile = z.object({
  personId: z.string(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  roles: z.array(CapRole),
  frozen: z.boolean(),
  joinedAt: z.coerce.date(),
  trustTier: z.string(),
  vehicle: z.object({ vehicleClass: z.string(), plate: z.string().nullable() }).nullable(),
  /** Null while offline. */
  live: z
    .object({
      state: DriverPinState,
      zoneId: z.string().nullable(),
      lastSeenAt: z.coerce.date(),
      tripId: z.string().nullable(),
    })
    .nullable(),
  lastActiveAt: z.coerce.date().nullable(),
  score: z.object({
    tier: CapTier.nullable(),
    index: z.number().nullable(),
    observation: z.boolean(),
    completedTrips: z.number().int(),
    metrics: z.array(
      z.object({
        key: ScoreMetricKey,
        label: z.string(),
        display: z.string(),
        value: z.number().nullable(),
        samples: z.number().int(),
      }),
    ),
  }),
  /** This Sunday-start week (Baghdad) so far, and last week whole. */
  week: z.object({ jobs: z.number().int(), netIqd: Iqd, tipsIqd: Iqd }),
  lastWeek: z.object({ jobs: z.number().int(), netIqd: Iqd }),
  /** Net and jobs per Baghdad day, the last 14, oldest first. */
  daily: z.array(z.object({ day: z.coerce.date(), netIqd: Iqd, jobs: z.number().int() })),
  /** Jobs by weekday (0 = Sunday) × Baghdad hour over the last 28 days. */
  heat: z.array(z.array(z.number().int().nonnegative())),
  cash: z.object({ heldIqd: Iqd, owedIqd: Iqd, capIqd: Iqd, overCap: z.boolean() }),
  docs: z.object({
    documents: z.array(
      z.object({
        kind: DriverDocumentKind,
        status: DriverDocumentStatus,
        expiresAt: z.coerce.date().nullable(),
      }),
    ),
    missing: z.array(DriverDocumentKind),
    blocksOnline: z.boolean(),
  }),
  ratings: z.object({
    avg: z.number().nullable(),
    count: z.number().int(),
    recent: z.array(
      z.object({
        orderId: z.string(),
        score: z.number().int(),
        reasons: z.array(z.string()),
        at: z.coerce.date(),
      }),
    ),
  }),
  complaints: z.object({
    total: z.number().int(),
    recent: z.array(ProfileTicket.extend({ faultParty: z.string() })),
  }),
});
export type DriverPeopleProfile = z.infer<typeof DriverPeopleProfile>;

// ───────────────────────── reveal a number ─────────────────────────

export const PhoneRevealReason = z.enum([
  'call_about_order',
  'call_back',
  'safety',
  'account_help',
]);
export type PhoneRevealReason = z.infer<typeof PhoneRevealReason>;
export const RevealPhoneInput = z.object({
  personId: z.string().min(1).max(60),
  reason: PhoneRevealReason,
});
export type RevealPhoneInput = z.input<typeof RevealPhoneInput>;
export const RevealedPhone = z.object({ phone: z.string().nullable(), at: z.coerce.date() });
export type RevealedPhone = z.infer<typeof RevealedPhone>;

export interface PeoplePort {
  customers(
    input: z.output<typeof PeopleCustomersInput>,
    accessorId: string,
  ): Promise<CustomersPage>;
  customer(input: z.output<typeof PersonInput>, accessorId: string): Promise<CustomerProfile>;
  driver(input: z.output<typeof PersonInput>, accessorId: string): Promise<DriverPeopleProfile>;
  story(input: z.output<typeof StoryInput>): Promise<StoryPage>;
  revealPhone(actor: Actor, input: z.output<typeof RevealPhoneInput>): Promise<RevealedPhone>;
}
