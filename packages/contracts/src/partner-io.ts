import { z } from 'zod';
import { RoleKind } from './auth.js';
import { CityId, Iqd, LatLng, Vertical } from './common.js';
import type { Actor } from './identity-io.js';
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
});
export type PartnerOffer = z.infer<typeof PartnerOffer>;

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
  arrivedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(),
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
}
