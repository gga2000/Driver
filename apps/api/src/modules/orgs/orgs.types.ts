import { FOOD_DOORS } from '@driver/contracts';
import type {
  FoodDoor,
  CommissionTier,
  HouseholdApprovalReason,
  DeliveryPoint,
  HolidayClosure,
  WeeklyWindow,
} from '@driver/contracts';

export type OrgType = 'restaurant' | 'grocer' | 'fleet' | 'household';
export type OrgMemberRole = 'payer' | 'orderer' | 'member';

export interface OrgMember {
  personId: string;
  role: OrgMemberRole;
  /** Household: orders above this ask the payer for one-tap approval. Null = no limit. */
  spendingLimitIqd: number | null;
  /** Household (joy w4): over this in a Baghdad month an order asks the payer. Null/absent = none. */
  monthlyBudgetIqd?: number | null;
}

export interface Org {
  id: string;
  type: OrgType;
  name: string;
  cityId: string;
  /** In join order: the creator (owner / first payer) first. */
  members: OrgMember[];
  /** Restaurants and grocers: order-taking settings (columns on `orgs`). */
  merchant?: MerchantSettings;
}

/** Local-time weekly window, e.g. Friday prayer `{dow: 5, start: '11:45', end: '13:15'}`. */
export interface MerchantPauseWindow {
  dow: number;
  start: string;
  end: string;
  reason?: string;
}

export interface MerchantSettings {
  /** Earned by behaviour (domain §2): skips the 90-s acceptance. */
  autoAccept: boolean;
  /** Null = the city's seeded defaults (Friday prayer). */
  pauseWindows: MerchantPauseWindow[] | null;
  /** Last merchant-app heartbeat (edge-case review A.2). */
  lastHeartbeatAt: Date | null;
  defaultPrepMin: number | null;
  /** Money §1 commission tier; null = the orders default. */
  commissionTier: CommissionTier | null;
  /** Pickup point couriers are sent to (zone key + pin); null until the merchant's place is on file. */
  location: DeliveryPoint | null;
  /** Busy mode (Driver Merchant): prep times +10 min until this time; null = off. */
  busyUntil?: Date | null;
  /** The busy minutes picked when it was switched on (r5: 10 or 20); null/absent = the default +10. */
  busyExtraMin?: number | null;
  /**
   * Closed by hand from the Merchant app (early-close reason); null = open. `until`: a quick pause
   * that reopens by itself (counter step 5, h2) — read it through `closedNow`, never directly.
   */
  closed?: MerchantClosed | null;
  /** The store's receipt printer as its tablet last reported it (printer-offline marker). */
  printer?: { state: 'connected' | 'disconnected'; name: string | null; at: Date } | null;
  /** Weekly opening shifts set from the Merchant app; null = the catalog's seeded hours. */
  openingHours?: WeeklyWindow[] | null;
  /** Dated closures (local dates, both included); null = none. */
  holidays?: HolidayClosure[] | null;
  hoursUpdatedAt?: Date | null;
  /** Where couriers collect orders (maps program r7); null = never set. */
  pickupSpot?: MerchantPickupSpot | null;
  /** «جهّز محلك»: the new shop's first-day setup; null = a shop from before setup (nothing changes for it). */
  setup?: MerchantSetupState | null;
}

/**
 * «جهّز محلك» as stored (`orgs.setup` JSON): what the owner confirmed and when, the menu photos' draft
 * behind his yes/fix cards and his answers, when he raised the shutter, and the shop's first real order.
 */
export interface MerchantSetupState {
  startedAt: Date;
  /** The four doors he confirmed («شنو تبيع؟»); null until he does. */
  kinds: FoodDoor[] | null;
  kindsAt: Date | null;
  payoutAt: Date | null;
  soundAt: Date | null;
  screenAt: Date | null;
  practiceAt: Date | null;
  printerLaterAt: Date | null;
  /** The shop photo he took before the storefront exists (`upload:<id>`); moved onto it at go-live. */
  shopPhotoRef: string | null;
  /** The menu-photo draft his cards come from. */
  menuJobId: string | null;
  /** His answer per card (by row index): kept as a dish (`itemId`) or left out. */
  cards: Record<string, { answer: 'ok' | 'skip'; itemId: string | null }>;
  /** He raised the shutter; null = not live yet (takes no orders). */
  liveAt: Date | null;
  /** True when setup closed the shop at its start, so going live opens it again (and nothing else does). */
  closedBySetup: boolean;
  firstOrder: { orderId: string; at: Date; seenAt: Date | null } | null;
}

export function newSetupState(at: Date): MerchantSetupState {
  return { startedAt: at, kinds: null, kindsAt: null, payoutAt: null, soundAt: null, screenAt: null, practiceAt: null, printerLaterAt: null, shopPhotoRef: null, menuJobId: null, cards: {}, liveAt: null, closedBySetup: false, firstOrder: null };
}

const DOORS: ReadonlySet<string> = new Set(FOOD_DOORS);

function dateOf(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `orgs.setup` read defensively (JSON written by `setupJson`); anything malformed reads as no setup. */
export function setupFrom(v: unknown): MerchantSetupState | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const startedAt = dateOf(o['startedAt']);
  if (!startedAt) return null;
  const cards: MerchantSetupState['cards'] = {};
  if (o['cards'] && typeof o['cards'] === 'object') {
    for (const [k, c] of Object.entries(o['cards'] as Record<string, unknown>)) {
      if (!c || typeof c !== 'object') continue;
      const a = (c as Record<string, unknown>)['answer'];
      const id = (c as Record<string, unknown>)['itemId'];
      if (a === 'ok' || a === 'skip') cards[k] = { answer: a, itemId: typeof id === 'string' ? id : null };
    }
  }
  const fo = o['firstOrder'] as Record<string, unknown> | null | undefined;
  const foAt = fo ? dateOf(fo['at']) : null;
  return {
    startedAt,
    kinds: Array.isArray(o['kinds']) ? (o['kinds'].filter((k) => typeof k === 'string' && DOORS.has(k)) as FoodDoor[]) : null,
    kindsAt: dateOf(o['kindsAt']),
    payoutAt: dateOf(o['payoutAt']),
    soundAt: dateOf(o['soundAt']),
    screenAt: dateOf(o['screenAt']),
    practiceAt: dateOf(o['practiceAt']),
    printerLaterAt: dateOf(o['printerLaterAt']),
    shopPhotoRef: typeof o['shopPhotoRef'] === 'string' ? o['shopPhotoRef'] : null,
    menuJobId: typeof o['menuJobId'] === 'string' ? o['menuJobId'] : null,
    cards,
    liveAt: dateOf(o['liveAt']),
    closedBySetup: o['closedBySetup'] === true,
    firstOrder: fo && typeof fo['orderId'] === 'string' && foAt ? { orderId: fo['orderId'], at: foAt, seenAt: dateOf(fo['seenAt']) } : null,
  };
}

/**
 * The pickup spot as stored: the owner's short note and photo upload ids (never URLs — they are read
 * through signed links), and when it was last saved.
 */
export interface MerchantPickupSpot {
  note: string | null;
  photoRefs: string[];
  updatedAt: Date;
}

export interface MerchantClosed {
  reason: string;
  note: string | null;
  at: Date;
  /** Reopens by itself at this time; null/absent = until someone reopens it. */
  until?: Date | null;
}

/**
 * The hand close in force at `now`: a quick pause past its `until` reads as open, the way busy mode
 * ends by itself (no job clears it). Every reader of `closed` goes through this.
 */
export function closedNow(closed: MerchantClosed | null | undefined, now: Date): MerchantClosed | null {
  if (!closed) return null;
  return closed.until && closed.until.getTime() <= now.getTime() ? null : closed;
}

export const DEFAULT_MERCHANT_SETTINGS: MerchantSettings = {
  autoAccept: false,
  pauseWindows: null,
  lastHeartbeatAt: null,
  defaultPrepMin: null,
  commissionTier: null,
  location: null,
  busyUntil: null,
  busyExtraMin: null,
  closed: null,
  printer: null,
  openingHours: null,
  holidays: null,
  hoursUpdatedAt: null,
  pickupSpot: null,
  setup: null,
};

/** A restaurant or grocer as the Console's merchant picker lists it. */
export interface MerchantOrg {
  id: string;
  name: string;
  type: 'restaurant' | 'grocer';
  cityId: string;
  lastHeartbeatAt: Date | null;
}

export interface PayerApprovalRequest {
  id: string;
  orgId: string;
  orderId: string;
  requestedBy: string;
  payerId: string;
  amountIqd: number;
  /** `withdrawn`: the order went away (cancelled, or no answer in time) before a decision. */
  state: 'pending' | 'approved' | 'declined' | 'withdrawn';
  /** Joy w4: why the order asks (null on requests made before J7c, or made by hand). */
  reason?: HouseholdApprovalReason | null;
  createdAt: Date;
}

export const isMerchantType = (t: OrgType): t is 'restaurant' | 'grocer' => t === 'restaurant' || t === 'grocer';
