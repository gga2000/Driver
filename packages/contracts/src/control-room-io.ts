import { z } from 'zod';
import type { Actor } from './identity-io.js';
import { CityId, Iqd, Vertical } from './common.js';
import { HhMm, LocalDate } from './store-hours.js';
import { VehicleFeature } from './vehicle-features.js';

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
  /** Filter by subject kind (`kill_switch`, `capacity`, `screen`, `banner`, `approval`, `ticket`, `export`). */
  subjectKind: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(200).default(50),
});

/** v10: the audit page's chips; which actions each holds is the server's (`modules/controls/audit.ts`). */
export const AUDIT_CATEGORIES = ['money', 'approvals', 'pauses', 'safety', 'orders', 'settings'] as const;
export const AuditCategory = z.enum(AUDIT_CATEGORIES);
export type AuditCategory = z.infer<typeof AuditCategory>;
export const AUDIT_PAGE_SIZE = 50;

/** One page of the audit log, newest first; `cursor` is the previous page's `nextCursor`. */
export const AuditPageInput = z.object({
  cityId: CityId.default('aziziyah'),
  category: AuditCategory.optional(),
  cursor: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(100).default(AUDIT_PAGE_SIZE),
});
export type AuditPageInput = z.input<typeof AuditPageInput>;
export const AuditPage = z.object({
  rows: z.array(AuditEntry),
  /** Every row the chip matches, not only this page. */
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});
export type AuditPage = z.infer<typeof AuditPage>;

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

// ───────────────────────── screen switches (W6, REL-16) ─────────────────────────

/**
 * The redesigned customer screens that ship beside the ones they replace (after-order design
 * Steps 1–4) and show only while their switch is on, so a bad night goes back without an app update.
 * Stored as `ui.<name>` rows in the kill-switch table; the apps see the bare names.
 */
export const ScreenSwitch = z.enum(['basket_v2', 'checkout_v2', 'track_v2', 'orders_v2']);
export type ScreenSwitch = z.infer<typeof ScreenSwitch>;

/** Who sees the new screen: nobody, staff only (anyone holding a Console role), or every customer. */
export const ScreenAudience = z.enum(['off', 'staff', 'all']);
export type ScreenAudience = z.infer<typeof ScreenAudience>;

export const ScreensInput = z.object({ cityId: CityId.optional() });
export type ScreensInput = z.infer<typeof ScreensInput>;

/** `system.screens`: which new screens this caller sees. Anything missing or unreadable = the old screen. */
export const PublicScreens = z.object({
  basket_v2: z.boolean(),
  checkout_v2: z.boolean(),
  track_v2: z.boolean(),
  orders_v2: z.boolean(),
});
export type PublicScreens = z.infer<typeof PublicScreens>;

export const ScreenSwitchView = z.object({
  cityId: z.string(),
  key: ScreenSwitch,
  audience: ScreenAudience,
  /** Why it was last changed; null = never set (off). */
  reason: z.string().nullable(),
  setBy: z.string().nullable(),
  setByName: z.string().nullable(),
  setAt: z.coerce.date().nullable(),
});
export type ScreenSwitchView = z.infer<typeof ScreenSwitchView>;

export const SetScreenSwitchInput = z.object({
  cityId: CityId.default('aziziyah'),
  key: ScreenSwitch,
  audience: ScreenAudience,
  reason: z.string().trim().min(3).max(300),
});
export type SetScreenSwitchInput = z.input<typeof SetScreenSwitchInput>;

// ───────────────────────── quiet days and the season (customer joy J1a) ─────────────────────────

/** The longest quiet stretch set in one go (Muharram 1–13 is 13 days). */
export const QUIET_MAX_DAYS = 15;

/**
 * The kinds of season period ops set (customer joy J6). `quiet` = mourning days (J1a): no
 * celebrations, sounds, offers or festive accent. `ramadan` adds iftar and suhoor times; `eid` a
 * greeting; `friday_special` a Friday card with ops' own line. Days are inclusive Baghdad dates.
 */
export const SeasonKind = z.enum(['quiet', 'ramadan', 'eid', 'friday_special']);
export type SeasonKind = z.infer<typeof SeasonKind>;

/** The longest period of each kind set in one go (Ramadan spans the union of both start days). */
export const SEASON_MAX_DAYS: Record<SeasonKind, number> = { quiet: QUIET_MAX_DAYS, ramadan: 31, eid: 5, friday_special: 1 };

/**
 * The maghrib timetable a person follows (picked once, on the device). Sunni and Shia maghrib
 * differ (Shia maghrib is later); the app never assumes one.
 */
export const Timetable = z.enum(['sunni', 'shia']);
export type Timetable = z.infer<typeof Timetable>;

/** Today's times on one timetable. */
export const TimetableTimes = z.object({
  /** Maghrib today: the fast ends. */
  iftarAt: z.coerce.date(),
  /** The next fajr after now while it still opens a Ramadan day (null on the last evening). */
  suhoorUntil: z.coerce.date().nullable(),
  /** The «على الفطور» delivery slot: a little before the adhan. */
  slotAt: z.coerce.date(),
});
export type TimetableTimes = z.infer<typeof TimetableTimes>;

/** A Ramadan day: both timetables, plus the picked one's times when the caller said which. */
export const RamadanToday = z.object({
  day: LocalDate,
  timetable: Timetable.nullable(),
  iftarAt: z.coerce.date().nullable(),
  suhoorUntil: z.coerce.date().nullable(),
  timetables: z.object({ sunni: TimetableTimes, shia: TimetableTimes }),
});
export type RamadanToday = z.infer<typeof RamadanToday>;

/** The calm home card a season shows (null text = the app's own words for the kind). */
export const SeasonHomeCard = z.object({
  kind: z.enum(['ramadan', 'eid', 'friday_special']),
  text_ar: z.string().nullable(),
});
export type SeasonHomeCard = z.infer<typeof SeasonHomeCard>;

/**
 * What an open app may do today (public read, every app polls it). On a quiet day (mourning, set by
 * ops in the Console) there are no celebrations, no moment sounds and no offers. J6 adds the kind,
 * the accent switch, the Ramadan times and the home card; clients ignore what they don't know.
 */
export const PublicSeason = z.object({
  quiet: z.boolean(),
  celebrations: z.boolean(),
  sounds: z.boolean(),
  promos: z.boolean(),
  /** The last quiet day (inclusive) while quiet, else null. */
  quietUntil: LocalDate.nullable(),
  /** The period that sets today's switches (quiet wins); `ordinary` when none. */
  kind: z.enum(['ordinary', 'quiet', 'ramadan', 'eid', 'friday_special']),
  /** False on quiet days: the accent is subdued, nothing festive. */
  accent: z.boolean(),
  /** Present on every day of a Ramadan period, quiet or not (iftar is service, not celebration). */
  ramadan: RamadanToday.nullable(),
  homeCard: SeasonHomeCard.nullable(),
});
export type PublicSeason = z.infer<typeof PublicSeason>;

export const SeasonInput = z.object({ cityId: CityId.optional(), timetable: Timetable.optional() });
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

/** One Ramadan day in the Console: both timetables, HH:MM Baghdad, and whether ops overrode it. */
export const SeasonDayTimes = z.object({
  day: LocalDate,
  sunni: z.object({ iftar: HhMm, suhoor: HhMm, overridden: z.boolean() }),
  shia: z.object({ iftar: HhMm, suhoor: HhMm, overridden: z.boolean() }),
});
export type SeasonDayTimes = z.infer<typeof SeasonDayTimes>;

export const SeasonView = QuietDaysView.extend({
  kind: SeasonKind,
  celebrations: z.boolean(),
  sounds: z.boolean(),
  promos: z.boolean(),
  accent: z.boolean(),
  homeCard: z.boolean(),
  homeCardAr: z.string().nullable(),
  /** Ramadan: minutes after sunset for the Shia maghrib (null = the default). */
  shiaOffsetMin: z.number().int().nullable(),
  /** Ramadan: every day of the period; empty for other kinds. */
  days: z.array(SeasonDayTimes),
});
export type SeasonView = z.infer<typeof SeasonView>;

/** Shia maghrib offsets ops may set (minutes after sunset). */
export const SHIA_OFFSET_RANGE = { min: 0, max: 40 } as const;
/**
 * The default Shia maghrib: this many minutes after sunset (commonly 10–15). VERIFY LOCALLY with the
 * timetable Aziziyah's Shia mosques print; ops can set it per Ramadan period and override any day.
 */
export const DEFAULT_SHIA_MAGHRIB_OFFSET_MIN = 15;

export const SetSeasonInput = z
  .object({
    /** null/absent = every city. */
    cityId: CityId.nullable().optional(),
    kind: SeasonKind,
    startsOn: LocalDate,
    endsOn: LocalDate,
    label_ar: z.string().trim().min(3).max(80),
    /** Switches for non-quiet kinds (quiet forces them off). Absent = on. */
    celebrations: z.boolean().optional(),
    sounds: z.boolean().optional(),
    promos: z.boolean().optional(),
    accent: z.boolean().optional(),
    /** Show a home card (Ramadan and Eid default on; a special Friday needs `homeCardAr`). */
    homeCard: z.boolean().optional(),
    homeCardAr: z.string().trim().min(3).max(80).nullable().optional(),
    shiaOffsetMin: z.number().int().min(SHIA_OFFSET_RANGE.min).max(SHIA_OFFSET_RANGE.max).nullable().optional(),
  })
  .refine((v) => v.endsOn >= v.startsOn, { message: 'endsOn is before startsOn', path: ['endsOn'] });
export type SetSeasonInput = z.input<typeof SetSeasonInput>;

export const ClearSeasonInput = z.object({ seasonId: z.string().min(1) });

/** Ops correct one day's iftar on one timetable (the local mosque's time); null removes the override. */
export const SetIftarTimeInput = z.object({ seasonId: z.string().min(1), day: LocalDate, timetable: Timetable, time: HhMm.nullable() });
export type SetIftarTimeInput = z.infer<typeof SetIftarTimeInput>;

// ───────────────────────── approvals queue ─────────────────────────

/**
 * `vehicle_features`: a verified vehicle's driver claimed features (n1, n2) the car check has not
 * confirmed yet. A fleet's new vehicle (`fleet_vehicle`) carries its claims in the same check.
 */
export const ApprovalKind = z.enum(['driver_document', 'merchant_deal', 'landmark_photo', 'merchant_onboarding', 'fleet_vehicle', 'vehicle_features']);
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
  /**
   * Vehicle items only: what the driver says the car offers, each with whether ops already confirmed
   * it; the reviewer ticks the ones he saw at the car check (`DecideApprovalInput.confirmFeatures`).
   */
  features: z.array(z.object({ feature: VehicleFeature, confirmed: z.boolean() })).default([]),
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
    /**
     * Vehicle items, on approve: the claimed features ops saw in the car (the rest are cleared from the
     * claims). Absent = every claim is confirmed. A rejected `vehicle_features` item clears them all.
     */
    confirmFeatures: z.array(VehicleFeature).optional(),
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
  auditPage(input: z.output<typeof AuditPageInput>): Promise<AuditPage>;
  banner(input: BannerInput): Promise<PublicBanner | null>;
  banners(): Promise<SystemBannerView[]>;
  setBanner(actor: Actor, input: z.output<typeof SetBannerInput>): Promise<SystemBannerView>;
  clearBanner(actor: Actor, input: { bannerId: string }): Promise<SystemBannerView>;
  season(input: SeasonInput): Promise<PublicSeason>;
  quietDays(): Promise<QuietDaysView[]>;
  setQuietDays(actor: Actor, input: z.output<typeof SetQuietDaysInput>): Promise<QuietDaysView>;
  clearQuietDays(actor: Actor, input: { quietId: string }): Promise<QuietDaysView>;
  seasons(): Promise<SeasonView[]>;
  setSeason(actor: Actor, input: z.output<typeof SetSeasonInput>): Promise<SeasonView>;
  clearSeason(actor: Actor, input: { seasonId: string }): Promise<SeasonView>;
  setIftarTime(actor: Actor, input: SetIftarTimeInput): Promise<SeasonView>;
  /** `isStaff` is asked only when some screen is on for staff only (it costs a role read). */
  screens(input: ScreensInput, isStaff: () => Promise<boolean>): Promise<PublicScreens>;
  screenSwitches(cityId: string): Promise<ScreenSwitchView[]>;
  setScreen(actor: Actor, input: z.output<typeof SetScreenSwitchInput>): Promise<ScreenSwitchView>;
}

/** `ctx.controlRoom`: approvals, the cash desk and the metrics wall (`modules/control-room`). */
export interface ControlRoomPort {
  approvals(actor: Actor, input: z.output<typeof ApprovalsInput>): Promise<ApprovalsView>;
  decide(actor: Actor, input: DecideApprovalInput): Promise<DecideApprovalOutput>;
  finance(actor: Actor, input: z.output<typeof FinanceInput>): Promise<FinanceDeskView>;
  exportSettlement(actor: Actor, input: z.output<typeof SettlementExportInput>): Promise<SettlementExport>;
  metrics(input: z.output<typeof MetricsInput>): Promise<LaunchMetricsView>;
}
