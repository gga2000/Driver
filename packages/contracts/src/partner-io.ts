import { z } from 'zod';
import { RoleKind } from './auth.js';
import { AnswerClimateCheckInput, ClimateFeature, PartnerClimateCheck } from './climate-check.js';
import { CityId, Iqd, LatLng, Vertical } from './common.js';
import type { Actor } from './identity-io.js';
import { RideCargo } from './ride-cargo.js';
import type { OrderRoute } from './tracking.js';
import { StopState, StopType, TripState, UnreachableStatus, VehicleClass } from './trip.js';

/**
 * Driver Partner reads (partner & merchant apps spec §Partner): the driver's own presence, the open
 * offer, the job he is on and today's money. Composed by the API's `partner` module from dispatch
 * (presence, offers, board), trips, orders, orgs and the ledger; nothing here is stored on its own.
 */

/** Roles that drive jobs (offers, presence, trips). Same set as `DRIVING_ROLES` in the trips router. */
export const PARTNER_DRIVING_ROLES: readonly RoleKind[] = ['courier', 'shopper', 'driver', 'intercity_driver', 'khat_driver'];
/** Everyone the Partner app lets in: drivers plus fleet owners and field ops. */
export const PARTNER_ROLES: readonly RoleKind[] = [...PARTNER_DRIVING_ROLES, 'fleet_owner', 'field_ops'];

/** What the Partner home is about: city courier, city rides, intercity garage, khat run, fleet, field ops. */
export const PartnerMode = z.enum(['courier', 'city', 'intercity', 'khat', 'fleet', 'ops']);
export type PartnerMode = z.infer<typeof PartnerMode>;

const MODE_OF_ROLE: Partial<Record<RoleKind, PartnerMode>> = {
  courier: 'courier',
  shopper: 'courier',
  driver: 'city',
  intercity_driver: 'intercity',
  khat_driver: 'khat',
  fleet_owner: 'fleet',
  field_ops: 'ops',
};

/** Modes for a set of role kinds, in a stable order (driving modes first). */
export function partnerModesOf(roles: readonly string[]): PartnerMode[] {
  const set = new Set<PartnerMode>();
  for (const r of roles) {
    const m = MODE_OF_ROLE[r as RoleKind];
    if (m) set.add(m);
  }
  return PartnerMode.options.filter((m) => set.has(m));
}

/** True when the person may use the Partner app at all (the app's role gate). */
export function isPartner(roles: readonly string[]): boolean {
  return roles.some((r) => (PARTNER_ROLES as readonly string[]).includes(r));
}

export const PartnerTier = z.enum(['bronze', 'silver', 'gold']);
export type PartnerTier = z.infer<typeof PartnerTier>;

/** How busy it is around the driver: drives the "الطلب عالي بالمركز" hint on the waiting screen. */
export const PartnerDemandLevel = z.enum(['high', 'normal', 'quiet']);
export type PartnerDemandLevel = z.infer<typeof PartnerDemandLevel>;

export const PartnerDemand = z.object({
  level: PartnerDemandLevel,
  /** The zone the hint is about: the busiest one nearby, or the driver's own. */
  zoneId: z.string().nullable(),
  /** Jobs waiting for a driver in that zone right now. */
  waitingJobs: z.number().int().min(0),
  /** Online drivers in that zone. */
  driversNearby: z.number().int().min(0),
});
export type PartnerDemand = z.infer<typeof PartnerDemand>;

/** Cash the driver holds vs his cap (money & ops §4: over cap = finish the job, no new offers). */
export const PartnerCash = z.object({
  /** Cash in his hand that isn't his (collected from customers, not yet settled). */
  heldIqd: Iqd.min(0),
  /** What counts against the cap: held cash net of what the platform owes him. */
  owedIqd: Iqd.min(0),
  capIqd: Iqd.min(0),
  remainingIqd: Iqd.min(0),
  overCap: z.boolean(),
  /** ≥ 70 % of the cap (`CAP_WARN_SHARE`): the app warns before offers stop. */
  nearCap: z.boolean(),
});
export type PartnerCash = z.infer<typeof PartnerCash>;

/** UI/UX audit P-05: the cap bar turns amber from 70 % of the cap … */
export const CAP_WARN_SHARE = 0.7;
/** … and red from 90 % (and at/over the cap, where offers stop). */
export const CAP_DANGER_SHARE = 0.9;

/**
 * One cash truth for the Partner app (P-05): the courier's "لازم تسلّم" number is what counts against
 * his cap (`owedIqd`), and the bar's length and colour both come from it — success below 70 %, warning
 * from 70 %, danger from 90 % or over the cap. `overIqd` is how far past the cap he is.
 */
export function capState(owedIqd: number, capIqd: number, overCap = false): { share: number; tone: 'success' | 'warning' | 'danger'; over: boolean; overIqd: number; leftIqd: number } {
  const share = capIqd > 0 ? Math.max(0, Math.min(1, owedIqd / capIqd)) : owedIqd > 0 ? 1 : 0;
  const over = overCap || (capIqd > 0 && owedIqd >= capIqd);
  const tone = over || share >= CAP_DANGER_SHARE ? 'danger' : share >= CAP_WARN_SHARE ? 'warning' : 'success';
  return { share, tone, over, overIqd: Math.max(0, owedIqd - capIqd), leftIqd: Math.max(0, capIqd - owedIqd) };
}

/** Why he may not go online now (same codes as `driverAccount.onlineGate`): scoring §2. */
export const PartnerGateCode = z.enum(['checkin_required', 'checkin_locked', 'document_expired']);
export type PartnerGateCode = z.infer<typeof PartnerGateCode>;

/** The online gate as `partner.status` carries it: `partner.goOnline` refuses while `canGoOnline` is false. */
export const PartnerOnlineGate = z.object({
  canGoOnline: z.boolean(),
  reasons: z.array(z.object({ code: PartnerGateCode, message_ar: z.string() })),
});
export type PartnerOnlineGate = z.infer<typeof PartnerOnlineGate>;

export const PartnerStatus = z.object({
  personId: z.string(),
  roles: z.array(RoleKind),
  modes: z.array(PartnerMode),
  /** The mode the home screen is built around (first driving mode, else fleet/ops). */
  primaryMode: PartnerMode.nullable(),
  /** Holds a driving role (may go online). */
  canDrive: z.boolean(),
  online: z.boolean(),
  /** When this shift started (first go-online since he was last offline); null while offline. */
  onlineSince: z.coerce.date().nullable().optional(),
  vehicleClass: VehicleClass.nullable(),
  tier: PartnerTier,
  zoneId: z.string().nullable(),
  position: LatLng.nullable(),
  cash: PartnerCash,
  today: z.object({ earningsIqd: Iqd, jobs: z.number().int().min(0) }),
  demand: PartnerDemand.nullable(),
  activeTripId: z.string().nullable(),
  offerId: z.string().nullable(),
  /** Daily check-in / lock-out / expired documents; null for people without a driving role. */
  gate: PartnerOnlineGate.nullable(),
  /** «المكيّفة شغالة اليوم؟» (ride idea x1): the shift's question on a hot / cold day; null when none applies. */
  climateCheck: PartnerClimateCheck.nullable().default(null),
});
export type PartnerStatus = z.infer<typeof PartnerStatus>;

export const PartnerGoOnlineInput = z.object({
  cityId: CityId.default('aziziyah'),
  at: LatLng,
  /** The vehicle he is on today; defaults to the registered one, else a bike. */
  vehicleClass: VehicleClass.optional(),
});
export type PartnerGoOnlineInput = z.infer<typeof PartnerGoOnlineInput>;

/**
 * Named pay components (money & ops §2: "Driver earnings live in Partner with every component
 * named"). Labels are client-side (`partner.pay_<key>`).
 */
export const PartnerPayKey = z.enum([
  /** Delivery fee by zone tier pair (passes to the courier in full). */
  'delivery',
  /** Ride fare share after the platform's take (shown openly). */
  'fare',
  'distance',
  'wait',
  /** Second order on the same route: 70 % of its delivery fee. */
  'batch_bonus',
  /** +500 for re-broadcast offers to drivers outside waves 1–2 (edge-case §6). */
  'pickup_compensation',
  'night',
  'weather',
  'peak',
  'door_pickup',
  'tip',
]);
export type PartnerPayKey = z.infer<typeof PartnerPayKey>;

export const PartnerPayComponent = z.object({ key: PartnerPayKey, amountIqd: Iqd });
export type PartnerPayComponent = z.infer<typeof PartnerPayComponent>;

export const PartnerPay = z.object({
  totalIqd: Iqd,
  components: z.array(PartnerPayComponent),
  /** Rides: the platform's share in percent, shown openly; null for deliveries (fee passes through). */
  takePct: z.number().min(0).max(100).nullable(),
});
export type PartnerPay = z.infer<typeof PartnerPay>;

/** The merchant side of a food/grocery job: name and how far the kitchen is. */
export const PartnerMerchantPrep = z.object({
  name: z.string(),
  state: z.enum(['waiting', 'preparing', 'ready', 'picked_up']),
  /** Minutes until the promised ready time (0 when ready or late); null when unknown. */
  readyInMin: z.number().int().min(0).nullable(),
});
export type PartnerMerchantPrep = z.infer<typeof PartnerMerchantPrep>;

export const PartnerOfferPlace = z.object({
  zoneId: z.string(),
  /** Merchant name at a pickup; null elsewhere (the zone name is the label). */
  label: z.string().nullable(),
  pin: LatLng.nullable(),
  /**
   * Partner redesign o7: the public landmark the stop is near («يم باب الجامع الكبير»), the way people
   * here give directions. Only town garages and meeting points (never a person's door); null when none
   * is close.
   */
  landmark: z.string().nullable().default(null),
});
export type PartnerOfferPlace = z.infer<typeof PartnerOfferPlace>;

export const PartnerOffer = z.object({
  offerId: z.string(),
  tripId: z.string(),
  vertical: Vertical,
  wave: z.number().int(),
  sentAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  /** The full ring: 15 s food, 20 s rides (dispatch spec §3). */
  ringSec: z.number().int().min(1),
  /** Counted as seen (3 s in the foreground, edge-case §6). */
  seen: z.boolean(),
  pickup: PartnerOfferPlace,
  dropoff: PartnerOfferPlace,
  distanceToPickupKm: z.number().min(0).nullable(),
  tripKm: z.number().min(0).nullable(),
  pay: PartnerPay,
  /** "طلب ثاني على طريقك +700": this offer rides along a job he already has. */
  batch: z.object({ extraIqd: Iqd, withTripIds: z.array(z.string()) }).nullable(),
  merchant: PartnerMerchantPrep.nullable(),
  /** Cash he collects at the door (cash orders); null when prepaid. */
  collectIqd: Iqd.nullable(),
  /**
   * Joy l9: a rider booked this ride for later and asked for him — «الزبون طلبك إنت». It rings for him
   * alone for a minute; nothing else about who favourited him is ever shown.
   */
  favourite: z.boolean().default(false),
  /** «راكب ينتظرك» (ride step 3, n4): the waiting rider nudged him on this offer; null = not. */
  nudgedAt: z.coerce.date().nullable().default(null),
  /** «عنده غراض: قنينة غاز» (ride idea x5): what the rider carries, so he knows before accepting; [] = nothing said. */
  rideCargo: z.array(RideCargo).default([]),
  /**
   * Ride ideas c9/s3: the ride was booked for someone else — the rider's name as the booker gave it for
   * the driver («المشوار لـ أم علي»). Null for a rider who booked it himself.
   */
  rider: z.object({ name: z.string() }).nullable().default(null),
  /**
   * Partner redesign o12: a car ride on a hot (cold) day, when dispatch sends rides to cars with working
   * AC (heating) first (ride idea x1) — the slip says «يوم حار · المكيّفة» so he switches it on. Null otherwise.
   */
  climate: ClimateFeature.nullable().default(null),
  /**
   * Partner redesign o10: how many rides the rider finished with us before this one (0 = first ride).
   * Rides only; null for deliveries. The rider's name stays off the offer (every driver in the wave sees it).
   */
  riderTrips: z.number().int().min(0).nullable().default(null),
});
export type PartnerOffer =z.infer<typeof PartnerOffer>;

/**
 * A ride booked for later as a driver sees it in «مشاوير باچر» (edge-case review #28): the time, the
 * pickup and drop-off zones, the trip km and his pay — what an offer shows, never a door or a name.
 * - `open`: waiting for a driver; he may confirm it until `confirmBy`.
 * - `confirmed`: his; from `startFrom` (T−60, the reminder) he may start toward the pickup; at `showBy`
 *   (T−30) it starts for him when he is online and free, otherwise it goes to another driver.
 */
export const PartnerBookedJob = z.object({
  tripId: z.string(),
  vertical: Vertical,
  scheduledFor: z.coerce.date(),
  state: z.enum(['open', 'confirmed']),
  pickup: z.object({ zoneId: z.string() }),
  dropoff: z.object({ zoneId: z.string() }),
  tripKm: z.number().min(0).nullable(),
  pay: PartnerPay,
  /** Cash he collects from the rider (cash rides); null when prepaid. */
  collectIqd: Iqd.nullable(),
  /** The rider asked for him (joy l9): «الزبون طلبك إنت». Nothing else about who is shown. */
  favourite: z.boolean(),
  confirmBy: z.coerce.date(),
  startFrom: z.coerce.date(),
  showBy: z.coerce.date(),
});
export type PartnerBookedJob = z.infer<typeof PartnerBookedJob>;

export const PartnerBookedJobs = z.object({
  /** Open jobs are matched to the vehicle he is online with: offline, he sees only his own. */
  online: z.boolean(),
  /** Jobs he confirmed, soonest first. */
  mine: z.array(PartnerBookedJob),
  /** Jobs waiting for a driver that fit him, soonest first. */
  open: z.array(PartnerBookedJob),
});
export type PartnerBookedJobs = z.infer<typeof PartnerBookedJobs>;

/** «أحجزه» / «مو إلي» on an open job; «ما أگدر أجي» / «طالع هسة» on his own. */
export const PartnerBookedAnswer = z.enum(['confirm', 'pass', 'release', 'start']);
export type PartnerBookedAnswer = z.infer<typeof PartnerBookedAnswer>;

export const AnswerBookedJobInput = z.object({ tripId: z.string().min(1), answer: PartnerBookedAnswer });
export type AnswerBookedJobInput = z.infer<typeof AnswerBookedJobInput>;

/**
 * The customer's door for the courier on the job (maps program f6, a5). Photos are signed links,
 * only for the assigned courier from accepting until an hour after the trip (domain §7).
 */
export const PartnerDoor = z.object({
  /** The saved place's standing note ("الباب الأسود، الطابق الثاني"); the order's own note stays in `note`. */
  placeNote: z.string().nullable(),
  photos: z.array(z.object({ id: z.string(), url: z.string() })),
  /** No delivery reached this place before: "اتصل قبل لا توصل" (a5). */
  firstVisit: z.boolean(),
  /** Earlier couriers' arrivals agree on the door (a3): the stop's pin is that door ("الباب مأكّد"). */
  doorConfirmed: z.boolean(),
  /** The customer marked the gate to come in by (a4): the stop's pin is that gate. */
  entranceSet: z.boolean(),
  /**
   * The landmark the customer said the house is near (a2), its Arabic name ("الجامع الكبير"): the
   * card reads «قرب الجامع الكبير», the way people here give directions. Null when none.
   */
  landmark: z.string().nullable(),
});
export type PartnerDoor = z.infer<typeof PartnerDoor>;

/**
 * Where the kitchen hands orders over (maps program r7): the restaurant's photos («الشباك اليسار»,
 * the side door) and its short note. Only on a pickup still to do, only for the assigned courier
 * during the job (the same rule as the customer's door); signed links.
 */
export const PartnerPickupSpot = z.object({
  note: z.string().nullable(),
  photos: z.array(z.object({ id: z.string(), url: z.string() })),
});
export type PartnerPickupSpot = z.infer<typeof PartnerPickupSpot>;

export const PartnerJobStop = z.object({
  stopId: z.string(),
  seq: z.number().int(),
  type: StopType,
  state: StopState,
  zoneId: z.string(),
  pin: LatLng.nullable(),
  /** Merchant name at a pickup, null at the customer's door. */
  label: z.string().nullable(),
  orderId: z.string().nullable(),
  /** The customer's courier note ("باب أخضر، يم الجامع"). */
  note: z.string().nullable(),
  /** Cash to take at this stop (dropoffs of cash orders); 0 otherwise. */
  collectIqd: Iqd.min(0),
  /** "الخردة علينا": the note the customer said he will pay with ("الزبون يدفع بـ 25,000"); null/absent = none. */
  tenderIqd: Iqd.nullable().optional(),
  arrivedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
  /** Pickups not yet done: the 4-digit code he shows at the counter (maps program r4); null otherwise. */
  pickupCode: z.string().nullable().optional(),
  /** A drop-off at a customer's saved place: what helps him find the door (maps program SP3d); null otherwise. */
  door: PartnerDoor.nullable().optional(),
  /** A pickup not yet done at a kitchen that set its pickup spot (maps program r7); null/absent otherwise. */
  pickupSpot: PartnerPickupSpot.nullable().optional(),
  /**
   * «عزيمة» (joy g1): the order is a gift. `hidePrices`: the sender paid and asked that the price is not
   * mentioned at the door («هدية — لا تذكر السعر») and no receipt goes in the bag. Null/absent = not a gift.
   */
  gift: z.object({ hidePrices: z.boolean() }).nullable().optional(),
  /**
   * s1 «رمز المشوار»: a night ride's pickup not yet done — the rider must tell him the 4 digits before
   * «الراكب صعد» (`trips.completeStop` with `startCode`). He never sees the code itself. Absent = none.
   */
  startCodeRequired: z.boolean().optional(),
  /**
   * Ride ideas c9/s3: a ride booked for someone else — the rider's name (as the booker gave it) on its
   * pickup and drop-off. «اتصل بالراكب» and the chat reach the rider, not the booker. Null/absent otherwise.
   */
  rider: z.object({ name: z.string() }).nullable().optional(),
  /**
   * Partner redesign j2: the public landmark the stop is near («يم جامع الرسول»), the way drivers give
   * directions — a town place from the landmark list, never a person's door; null when none is close.
   */
  landmark: z.string().nullable().default(null),
});
export type PartnerJobStop = z.infer<typeof PartnerJobStop>;

export const PartnerJob = z.object({
  tripId: z.string(),
  vertical: Vertical,
  state: TripState,
  acceptedAt: z.coerce.date().nullable(),
  stops: z.array(PartnerJobStop),
  /** The one task on screen: first stop not completed or skipped. Null when all are done. */
  currentStopId: z.string().nullable(),
  unreachable: UnreachableStatus.nullable(),
  pay: PartnerPay,
  merchant: PartnerMerchantPrep.nullable(),
  /** Ride idea x5: what the rider carries (bags, a gas cylinder, something big); [] = nothing said. */
  rideCargo: z.array(RideCargo).default([]),
});
export type PartnerJob = z.infer<typeof PartnerJob>;

/** The first stop still to work (pending or arrived), in run order. */
export function partnerCurrentStop<T extends { seq: number; state: string; stopId: string }>(stops: readonly T[]): T | null {
  return [...stops].sort((a, b) => a.seq - b.seq).find((s) => s.state === 'pending' || s.state === 'arrived') ?? null;
}

/** What the API supplies to the partner router (implemented by `modules/partner`). */
export interface PartnerPort {
  status(actor: Actor): Promise<PartnerStatus>;
  goOnline(actor: Actor, input: PartnerGoOnlineInput): Promise<PartnerStatus>;
  goOffline(actor: Actor): Promise<PartnerStatus>;
  currentOffer(actor: Actor): Promise<PartnerOffer | null>;
  activeJob(actor: Actor): Promise<PartnerJob | null>;
  /**
   * The road from him to the offer's pickup (maps program d2) — only a kitchen's: every driver in the
   * wave sees an offer, so a person's door (a ride's pickup, any drop-off) never shapes its road.
   */
  offerRoute(actor: Actor, input: PartnerOfferRouteInput): Promise<OrderRoute>;
  /** The road from his last fix through the job's remaining stops, in order (maps program d2). */
  jobRoute(actor: Actor): Promise<OrderRoute>;
  /** Where the orders are now and in the coming hour, against the drivers there (maps program d5). */
  demandMap(actor: Actor): Promise<PartnerDemandMap>;
  /** «المكيّفة شغالة اليوم؟» نعم / لا for this shift (ride idea x1); `climate_check_none` when nothing is asked. */
  answerClimateCheck(actor: Actor, input: AnswerClimateCheckInput): Promise<PartnerStatus>;
  /** «مشاوير باچر» (review #28): rides booked for later he confirmed, and the ones he may confirm. */
  bookedJobs(actor: Actor): Promise<PartnerBookedJobs>;
  /** Confirm / pass on an open booked job, release or start his own; answers with the fresh list. */
  answerBookedJob(actor: Actor, input: AnswerBookedJobInput): Promise<PartnerBookedJobs>;
}

/** Where the orders are (maps program d5). */
export const DEMAND_MAP_RULES = {
  /** The app re-reads the map this often. */
  refreshMs: 60_000,
  /** The forecast: pickups in this hour on the same weekday, averaged over this many weeks. */
  weeks: 4,
} as const;

export const DemandLevel = z.enum(['hot', 'warm', 'calm']);
export type DemandLevel = z.infer<typeof DemandLevel>;

export const PartnerDemandMap = z.object({
  /** Zones with anything going on; the rest are calm. */
  zones: z.array(
    z.object({
      zoneId: z.string(),
      /** Jobs waiting for a driver there now. */
      waiting: z.number().int().min(0),
      /** Pickups usually started there in the coming hour (average of the last weeks, one decimal). */
      expected: z.number().min(0),
      /** Online drivers in the zone. */
      drivers: z.number().int().min(0),
      level: DemandLevel,
    }),
  ),
  at: z.coerce.date(),
});
export type PartnerDemandMap = z.infer<typeof PartnerDemandMap>;

export const PartnerOfferRouteInput = z.object({ offerId: z.string().min(1) });
export type PartnerOfferRouteInput = z.infer<typeof PartnerOfferRouteInput>;
