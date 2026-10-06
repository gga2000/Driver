import { z } from 'zod';
import type { Actor } from './identity-io.js';
import { CityId, Iqd, Vertical } from './common.js';
import { LocalDate } from './store-hours.js';

/**
 * Launch-week control room (launch playbook §3 controls, §4 rota, §6 metrics): kill switches,
 * per-zone capacity throttle, the status banner every app shows, the approvals queue, the nightly
 * cash desk and the metrics wall. Served by `apps/api/src/modules/{controls,control-room}`.
 */

// ───────────────────────── kill switches ─────────────────────────

/** What a switch stops: a whole vertical, one zone, one restaurant, or one الرجعة corridor. */
export const KillScope = z.enum(['vertical', 'zone', 'restaurant', 'corridor']);
export type KillScope = z.infer<typeof KillScope>;

export const KillSwitchView = z.object({
  id: z.string(),
  cityId: z.string(),
  scope: KillScope,
  /** The vertical, zone key, merchant org id or corridor id. */
  key: z.string(),
  /** Arabic name of what is switched off (zone name, restaurant name…). */
  label_ar: z.string(),
  /** Zone switches may stop one vertical only; null = every vertical in that zone. */
  vertical: Vertical.nullable(),
  active: z.boolean(),
  /** Also stop automatic offers into this scope: new jobs go to the dispatcher (suggest-only). */
  holdDispatch: z.boolean(),
  /** Shown to customers instead of the default refusal. */
  message_ar: z.string().nullable(),
  reason: z.string(),
  setBy: z.string(),
  setByName: z.string().nullable(),
  setAt: z.coerce.date(),
  /** Switches back on by itself at this time; null = until switched back by hand. */
  expiresAt: z.coerce.date().nullable(),
});
export type KillSwitchView = z.infer<typeof KillSwitchView>;

export const SetKillSwitchInput = z.object({
  cityId: CityId.default('aziziyah'),
  scope: KillScope,
  key: z.string().trim().min(1).max(80),
  vertical: Vertical.optional(),
  active: z.boolean(),
  holdDispatch: z.boolean().default(false),
  message_ar: z.string().trim().max(200).optional(),
  reason: z.string().trim().min(3).max(300),
  expiresAt: z.coerce.date().optional(),
});
export type SetKillSwitchInput = z.input<typeof SetKillSwitchInput>;

// ───────────────────────── capacity throttle ─────────────────────────

/** Over capacity: `refuse` new orders, or `queue` them (the refusal offers the next slot; a scheduled order at it passes). */
export const ThrottleMode = z.enum(['refuse', 'queue']);
export type ThrottleMode = z.infer<typeof ThrottleMode>;

export const ZoneLoadState = z.enum(['off', 'ok', 'busy', 'full']);
export type ZoneLoadState = z.infer<typeof ZoneLoadState>;

export const ZoneCapacityView = z.object({
  zoneKey: z.string(),
  name_ar: z.string(),
  tier: z.string(),
  /** Max concurrent active orders for customers in this zone; null = no throttle. */
  maxActive: z.number().int().nullable(),
  mode: ThrottleMode,
  /** The honest wait the refusal promises ("جرّب بعد ربع ساعة"). */
  etaMin: z.number().int(),
  /** Active orders right now (customer side of the zone). */
  active: z.number().int(),
  /** active / maxActive (0 when not throttled). */
  load: z.number(),
  state: ZoneLoadState,
  /** A zone kill switch is on. */
  killed: z.boolean(),
  setBy: z.string().nullable(),
  setAt: z.coerce.date().nullable(),
});
export type ZoneCapacityView = z.infer<typeof ZoneCapacityView>;

export const SetZoneCapacityInput = z.object({
  cityId: CityId.default('aziziyah'),
  zoneKey: z.string().trim().min(1).max(60),
  /** null removes the throttle. */
  maxActive: z.number().int().min(1).max(500).nullable(),
  mode: ThrottleMode.default('refuse'),
  etaMin: z.number().int().min(5).max(120).default(15),
});
export type SetZoneCapacityInput = z.input<typeof SetZoneCapacityInput>;

export const ControlsInput = z.object({ cityId: CityId.default('aziziyah') });

export const ControlTarget = z.object({ key: z.string(), label_ar: z.string(), killed: z.boolean() });
export type ControlTarget = z.infer<typeof ControlTarget>;

export const ControlsView = z.object({
  cityId: z.string(),
  at: z.coerce.date(),
  /** Every switch that is on (and the ones that expired or were switched back in the last 24 h). */
  switches: z.array(KillSwitchView),
  zones: z.array(ZoneCapacityView),
  verticals: z.array(ControlTarget),
  restaurants: z.array(ControlTarget),
  corridors: z.array(ControlTarget),
  /** Active orders in the city right now and across throttled zones. */
  activeOrders: z.number().int(),
});
export type ControlsView = z.infer<typeof ControlsView>;

/** One row of the console audit log (every control-room action). */
export const AuditEntry = z.object({
  id: z.string(),
  at: z.coerce.date(),
  actorId: z.string(),
  actorName: z.string().nullable(),
  action: z.string(),
  subjectKind: z.string(),
  subjectId: z.string(),
  summary_ar: z.string(),
  detail: z.record(z.unknown()),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditInput = z.object({
  cityId: CityId.default('aziziyah'),
  /** Filter by subject kind (`kill_switch`, `capacity`, `banner`, `approval`, `ticket`, `export`). */
  subjectKind: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

// ───────────────────────── status banner ─────────────────────────

export const BannerSeverity = z.enum(['info', 'warning', 'critical']);
export type BannerSeverity = z.infer<typeof BannerSeverity>;

export const BannerAudience = z.enum(['customer', 'partner', 'merchant']);
export type BannerAudience = z.infer<typeof BannerAudience>;

/** What an open app shows (public read; no author). */
export const PublicBanner = z.object({
  id: z.string(),
  severity: BannerSeverity,
  message_ar: z.string(),
  message_en: z.string().nullable(),
  expiresAt: z.coerce.date(),
});
export type PublicBanner = z.infer<typeof PublicBanner>;

export const SystemBannerView = PublicBanner.extend({
  cityId: z.string().nullable(),
  audiences: z.array(BannerAudience),
  startsAt: z.coerce.date(),
  active: z.boolean(),
  setBy: z.string(),
  setByName: z.string().nullable(),
  setAt: z.coerce.date(),
  clearedAt: z.coerce.date().nullable(),
});
export type SystemBannerView = z.infer<typeof SystemBannerView>;

export const BannerInput = z.object({ app: BannerAudience, cityId: CityId.optional() });
export type BannerInput = z.infer<typeof BannerInput>;

export const SetBannerInput = z.object({
  /** null/absent = every city. */
  cityId: CityId.nullable().optional(),
  severity: BannerSeverity,
  audiences: z.array(BannerAudience).min(1).max(3),
  message_ar: z.string().trim().min(3).max(200),
  message_en: z.string().trim().max(200).optional(),
  startsAt: z.coerce.date().optional(),
  /** A banner always ends: at most 24 h ahead (a longer notice is set again the next day). */
  expiresAt: z.coerce.date(),
});
export type SetBannerInput = z.input<typeof SetBannerInput>;

export const ClearBannerInput = z.object({ bannerId: z.string().min(1) });

// ───────────────────────── quiet days and the season (customer joy J1a) ─────────────────────────

/** The longest quiet stretch set in one go (Muharram 1–13 is 13 days). */
export const QUIET_MAX_DAYS = 15;

/**
 * What an open app may do today (public read, every app polls it). On a quiet day (mourning, set by
 * ops in the Console) there are no celebrations, no moment sounds and no offers. The J6 season system
 * adds fields here; clients ignore what they don't know.
 */
export const PublicSeason = z.object({
  quiet: z.boolean(),
  celebrations: z.boolean(),
  sounds: z.boolean(),
  promos: z.boolean(),
  /** The last quiet day (inclusive) while quiet, else null. */
  quietUntil: LocalDate.nullable(),
});
export type PublicSeason = z.infer<typeof PublicSeason>;

export const SeasonInput = z.object({ cityId: CityId.optional() });
export type SeasonInput = z.infer<typeof SeasonInput>;

export const QuietDaysView = z.object({
  id: z.string(),
  cityId: z.string().nullable(),
  startsOn: LocalDate,
  endsOn: LocalDate,
  label_ar: z.string(),
  active: z.boolean(),
  setBy: z.string(),
  setByName: z.string().nullable(),
  setAt: z.coerce.date(),
  clearedAt: z.coerce.date().nullable(),
});
export type QuietDaysView = z.infer<typeof QuietDaysView>;

export const SetQuietDaysInput = z
  .object({
    /** null/absent = every city. */
    cityId: CityId.nullable().optional(),
    startsOn: LocalDate,
    endsOn: LocalDate,
    label_ar: z.string().trim().min(3).max(80),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn is before startsOn', path: ['endsOn'] });
export type SetQuietDaysInput = z.input<typeof SetQuietDaysInput>;

export const ClearQuietDaysInput = z.object({ quietId: z.string().min(1) });

// ───────────────────────── approvals queue ─────────────────────────

export const ApprovalKind = z.enum(['driver_document', 'merchant_deal', 'landmark_photo', 'merchant_onboarding', 'fleet_vehicle']);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalPhoto = z.object({ url: z.string(), label_ar: z.string() });
export type ApprovalPhoto = z.infer<typeof ApprovalPhoto>;

export const ApprovalFact = z.object({ label_ar: z.string(), value: z.string() });

export const ApprovalItem = z.object({
  /** `<kind>:<refId>` */
  id: z.string(),
  kind: ApprovalKind,
  kind_ar: z.string(),
  refId: z.string(),
  title_ar: z.string(),
  subtitle_ar: z.string().nullable(),
  submittedAt: z.coerce.date(),
  submittedBy: z.string().nullable(),
  submittedByName: z.string().nullable(),
  /** The reviewer is the subject or the submitter: he cannot decide on it. */
  ownItem: z.boolean(),
  /** What is under review (left pane). */
  photos: z.array(ApprovalPhoto),
  /** What to compare it with (right pane): the ID photo, the place's current photos… */
  compare: z.array(ApprovalPhoto),
  facts: z.array(ApprovalFact),
  /** Approving a document can set its expiry. */
  takesExpiry: z.boolean(),
});
export type ApprovalItem = z.infer<typeof ApprovalItem>;

export const ApprovalsInput = z.object({ cityId: CityId.default('aziziyah'), kind: ApprovalKind.optional() });

export const ApprovalsView = z.object({
  at: z.coerce.date(),
  items: z.array(ApprovalItem),
  counts: z.record(ApprovalKind, z.number().int()),
});
export type ApprovalsView = z.infer<typeof ApprovalsView>;

export const DecideApprovalInput = z
  .object({
    kind: ApprovalKind,
    refId: z.string().min(1),
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(300).optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .refine((v) => v.decision === 'approve' || (v.reason?.length ?? 0) >= 3, { message: 'reason required to reject', path: ['reason'] });
export type DecideApprovalInput = z.infer<typeof DecideApprovalInput>;

export const DecideApprovalOutput = z.object({ id: z.string(), kind: ApprovalKind, refId: z.string(), decision: z.enum(['approve', 'reject']), decidedAt: z.coerce.date() });
export type DecideApprovalOutput = z.infer<typeof DecideApprovalOutput>;

// ───────────────────────── finance desk / nightly cash ─────────────────────────

export const FinanceInput = z.object({ cityId: CityId.default('aziziyah') });

export const CourierCashRow = z.object({
  driverId: z.string(),
  name: z.string().nullable(),
  zoneKey: z.string().nullable(),
  zone_ar: z.string().nullable(),
  online: z.boolean(),
  heldIqd: Iqd,
  owedIqd: z.number().int(),
  capIqd: Iqd,
  /** owed / cap */
  fill: z.number(),
  overCap: z.boolean(),
  tier: z.string(),
});
export type CourierCashRow = z.infer<typeof CourierCashRow>;

export const MerchantPayableRow = z.object({
  merchantId: z.string(),
  name: z.string(),
  payableIqd: z.number().int(),
  mode: z.string(),
  exposureCapIqd: Iqd,
  overExposure: z.boolean(),
});
export type MerchantPayableRow = z.infer<typeof MerchantPayableRow>;

export const HandoverRow = z.object({
  at: z.coerce.date(),
  kind: z.enum(['courier_to_ops', 'courier_to_merchant']),
  courierId: z.string(),
  courierName: z.string().nullable(),
  counterpart: z.string().nullable(),
  amountIqd: Iqd,
  reference: z.string().nullable(),
});
export type HandoverRow = z.infer<typeof HandoverRow>;

/** S-K5: a courier ticked off on tonight's round ("استلمت", confirmed with his daily code). */
export const RoundCollection = z.object({ amountIqd: Iqd, at: z.coerce.date(), reference: z.string().nullable() });
export type RoundCollection = z.infer<typeof RoundCollection>;

export const RoundStop = z.object({
  seq: z.number().int(),
  zoneKey: z.string(),
  zone_ar: z.string(),
  couriers: z.array(
    z.object({
      driverId: z.string(),
      name: z.string().nullable(),
      /** Still in his hand. */
      heldIqd: Iqd,
      overCap: z.boolean(),
      /** What field ops took from him on tonight's round (sum), the last time and reference; null = not yet. */
      collected: RoundCollection.nullable().optional(),
    }),
  ),
  /** Still to collect at this stop. */
  totalIqd: Iqd,
  /** Already collected at this stop tonight. */
  collectedIqd: Iqd.optional(),
});
export type RoundStop = z.infer<typeof RoundStop>;

export const NightlyCheck = z.object({
  ok: z.boolean(),
  message_ar: z.string(),
  moneyNet: z.number(),
  pointsNet: z.number(),
  kindViolations: z.number().int(),
  checkedAt: z.coerce.date(),
  /** The last 02:00 close on file (events), if any. */
  lastClose: z.object({ day: z.string(), ok: z.boolean(), runAt: z.coerce.date() }).nullable(),
});
export type NightlyCheck = z.infer<typeof NightlyCheck>;

export const FinanceDeskView = z.object({
  cityId: z.string(),
  at: z.coerce.date(),
  localDate: z.string(),
  couriers: z.array(CourierCashRow),
  merchants: z.array(MerchantPayableRow),
  handovers: z.array(HandoverRow),
  /** The 23:00 collection round: stops ordered as a route through the zones, from the centre. */
  round: z.object({
    at: z.coerce.date(),
    stops: z.array(RoundStop),
    /** Still to collect. */
    totalIqd: Iqd,
    /** S-K5: collected on tonight's round so far ("جمعنا 612,000 من 746,710 دينار"). */
    collectedIqd: Iqd.optional(),
    /** collected + still to collect. */
    targetIqd: Iqd.optional(),
    /** Tonight's round window (receipts from `from` count as collected on this round). */
    from: z.coerce.date().optional(),
  }),
  nightly: NightlyCheck,
  totals: z.object({ cashInFieldIqd: Iqd, merchantsPayableIqd: z.number().int(), collectedTodayIqd: Iqd, couriersOverCap: z.number().int() }),
});
export type FinanceDeskView = z.infer<typeof FinanceDeskView>;

export const SettlementExportInput = z.object({
  cityId: CityId.default('aziziyah'),
  kind: z.enum(['couriers', 'merchants', 'handovers', 'round']),
});
export type SettlementExportInput = z.input<typeof SettlementExportInput>;

export const SettlementExport = z.object({ filename: z.string(), csv: z.string(), rows: z.number().int() });
export type SettlementExport = z.infer<typeof SettlementExport>;

// ───────────────────────── launch metrics wall ─────────────────────────

export const MetricsInput = z.object({ cityId: CityId.default('aziziyah'), since: z.coerce.date().optional() });

export const LaunchMetric = z.object({
  key: z.enum(['median_delivery', 'acceptance', 'disputes_24h', 'orders_day', 'rajaa_seats', 'ledger']),
  label_ar: z.string(),
  value: z.number().nullable(),
  display: z.string(),
  target_ar: z.string(),
  /** Meets the playbook target. null = not enough data yet. */
  ok: z.boolean().nullable(),
  hint_ar: z.string().nullable(),
  /** S-K6: the same tile 24 hours ago (trend arrow vs yesterday); null when it can't be known. */
  previous: z.number().nullable().optional(),
  /** Which way is better for this tile: up (acceptance, orders) or down (minutes, open disputes). */
  better: z.enum(['up', 'down']).optional(),
});
export type LaunchMetric = z.infer<typeof LaunchMetric>;

export const LaunchMetricsView = z.object({
  cityId: z.string(),
  at: z.coerce.date(),
  since: z.coerce.date(),
  /** Day of the launch week (1–7…). */
  day: z.number().int(),
  metrics: z.array(LaunchMetric),
  ordersByDay: z.array(z.object({ date: z.string(), orders: z.number().int() })),
  deliverySamples: z.number().int(),
  offers: z.object({ accepted: z.number().int(), answered: z.number().int() }),
  openTickets: z.number().int(),
});
export type LaunchMetricsView = z.infer<typeof LaunchMetricsView>;

// ───────────────────────── ports ─────────────────────────

/** `ctx.controls`: switches, throttle, banner and the audit log (`modules/controls`). */
export interface ControlsPort {
  view(cityId: string): Promise<ControlsView>;
  setSwitch(actor: Actor, input: z.output<typeof SetKillSwitchInput>): Promise<KillSwitchView>;
  setCapacity(actor: Actor, input: z.output<typeof SetZoneCapacityInput>): Promise<ZoneCapacityView>;
  audit(input: z.output<typeof AuditInput>): Promise<AuditEntry[]>;
  banner(input: BannerInput): Promise<PublicBanner | null>;
  banners(): Promise<SystemBannerView[]>;
  setBanner(actor: Actor, input: z.output<typeof SetBannerInput>): Promise<SystemBannerView>;
  clearBanner(actor: Actor, input: { bannerId: string }): Promise<SystemBannerView>;
  season(input: SeasonInput): Promise<PublicSeason>;
  quietDays(): Promise<QuietDaysView[]>;
  setQuietDays(actor: Actor, input: z.output<typeof SetQuietDaysInput>): Promise<QuietDaysView>;
  clearQuietDays(actor: Actor, input: { quietId: string }): Promise<QuietDaysView>;
}

/** `ctx.controlRoom`: approvals, the cash desk and the metrics wall (`modules/control-room`). */
export interface ControlRoomPort {
  approvals(actor: Actor, input: z.output<typeof ApprovalsInput>): Promise<ApprovalsView>;
  decide(actor: Actor, input: DecideApprovalInput): Promise<DecideApprovalOutput>;
  finance(actor: Actor, input: z.output<typeof FinanceInput>): Promise<FinanceDeskView>;
  exportSettlement(actor: Actor, input: z.output<typeof SettlementExportInput>): Promise<SettlementExport>;
  metrics(input: z.output<typeof MetricsInput>): Promise<LaunchMetricsView>;
}
