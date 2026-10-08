import { z } from 'zod';
import type { Actor } from './identity-io.js';
import { FOOD_DOORS, type FoodDoor } from './food-doors.js';
import { ImportedItem } from './merchant-admin-io.js';
import { MerchantOrgInput, type PrepKind } from './merchant-io.js';
import { hhmmToMinutes, storeHoursProblems, type DayHours, type HoursShift } from './store-hours.js';

/**
 * «جهّز محلك» (merchant setup, Ali 2026-10-08: "do what's best"): the first day of a new shop on
 * Driver, from «your shop is live» to the first real order. The owner opens on his own shop page with
 * what is missing lit up, a ring that fills («جاهز 40٪») and one next step; the menu comes back from a
 * photo as yes/fix cards; the counter gets a short runway (sound, screen, pickup spot, a practice order);
 * and the last step is raising his own shutter. Setup never blocks work: «بعدين» is always allowed and
 * the board keeps a calm card with what is left until he is live.
 *
 * Pure parts (the steps, the ready percent, the minutes left, the ready-made hours) are shared by the
 * API (`merchant.setup.*`) and the Merchant app, and unit-tested here.
 */

// ───────────────────────── the steps ─────────────────────────

/** The seven things a shop needs before its first order, in the order setup asks for them. */
export const SETUP_STEPS = ['kind', 'menu', 'photos', 'hours', 'money', 'pickup', 'counter'] as const;
export const SetupStep = z.enum(SETUP_STEPS);
export type SetupStep = z.infer<typeof SetupStep>;

/**
 * Each step's share of the ready ring (out of 10, so the ring moves in tens) and the owner's own time
 * for it, from the setup review's table (a shop with about 25 dishes). The menu is the big one.
 */
export const SETUP_STEP_RULES: Readonly<Record<SetupStep, { weight: number; seconds: number }>> = {
  kind: { weight: 1, seconds: 10 },
  menu: { weight: 3, seconds: 360 },
  photos: { weight: 2, seconds: 60 },
  hours: { weight: 1, seconds: 20 },
  money: { weight: 1, seconds: 20 },
  pickup: { weight: 1, seconds: 30 },
  counter: { weight: 1, seconds: 120 },
};

/** Checking one read dish card (a glance and a tap) and choosing one photo, in seconds. */
export const SETUP_SECONDS_PER_CARD = 8;
export const SETUP_SECONDS_PER_PHOTO = 10;

/** What the server knows about a shop's setup; everything the steps are judged by. */
export interface SetupFacts {
  /** The owner confirmed what he sells (field ops' pick only suggests it). */
  kindsConfirmed: boolean;
  /** Dishes on the menu (live ones; read cards not yet answered don't count). */
  items: number;
  /** Read dish cards still waiting for his «صح» or «مو هذا». */
  pendingCards: number;
  /** Dishes on the menu with no photo at all (a library photo counts: Ali, 2026-10-08). */
  missingPhotos: number;
  /** Opening hours on file (his own, or the ones field ops entered). */
  hoursSet: boolean;
  /** He has seen how and when he gets his money, once. */
  payoutSeen: boolean;
  pickupSet: boolean;
  /** He ran the practice order to the hand-over. */
  practiced: boolean;
}

export interface SetupStepState {
  key: SetupStep;
  done: boolean;
  /** His time still needed for it (0 when done). */
  seconds: number;
}

export interface SetupProgress {
  steps: SetupStepState[];
  /** 0–100 in tens (step weights out of 10). */
  percent: number;
  done: number;
  total: number;
  /** Steps still to do. */
  left: number;
  /** Rounded up; 0 when everything is done. */
  minutesLeft: number;
  /** The first step not done, in setup's order; null when ready to go live. */
  next: SetupStep | null;
}

function stepDone(key: SetupStep, f: SetupFacts): boolean {
  switch (key) {
    case 'kind':
      return f.kindsConfirmed;
    case 'menu':
      return f.items > 0 && f.pendingCards === 0;
    case 'photos':
      return f.items > 0 && f.missingPhotos === 0;
    case 'hours':
      return f.hoursSet;
    case 'money':
      return f.payoutSeen;
    case 'pickup':
      return f.pickupSet;
    case 'counter':
      return f.practiced;
  }
}

function stepSeconds(key: SetupStep, f: SetupFacts): number {
  const base = SETUP_STEP_RULES[key].seconds;
  if (key === 'menu' && f.pendingCards > 0) return Math.max(60, f.pendingCards * SETUP_SECONDS_PER_CARD);
  if (key === 'photos' && f.missingPhotos > 0) return Math.max(30, f.missingPhotos * SETUP_SECONDS_PER_PHOTO);
  return base;
}

/** The steps, the ring and the minutes left, from the facts. */
export function setupProgress(f: SetupFacts): SetupProgress {
  const steps = SETUP_STEPS.map((key) => {
    const done = stepDone(key, f);
    return { key, done, seconds: done ? 0 : stepSeconds(key, f) };
  });
  const total = steps.length;
  const doneCount = steps.filter((s) => s.done).length;
  const weight = steps.reduce((sum, s) => sum + (s.done ? SETUP_STEP_RULES[s.key].weight : 0), 0);
  const allWeight = SETUP_STEPS.reduce((sum, k) => sum + SETUP_STEP_RULES[k].weight, 0);
  const seconds = steps.reduce((sum, s) => sum + s.seconds, 0);
  return {
    steps,
    // A finished shop is 100 exactly; anything short of it never rounds up to 100.
    percent: doneCount === total ? 100 : Math.min(90, Math.floor((weight / allWeight) * 10) * 10),
    done: doneCount,
    total,
    left: total - doneCount,
    minutesLeft: Math.ceil(seconds / 60),
    next: steps.find((s) => !s.done)?.key ?? null,
  };
}

// ───────────────────────── what he sells ─────────────────────────

/**
 * The tag each door writes on the storefront (so the customer app's doors and `doorOf` place the shop).
 * A meal shop keeps the meal tags field ops gave it; with none it gets «grill».
 */
export const DOOR_TAG: Readonly<Record<FoodDoor, string>> = { meal: 'grill', cafe: 'cafe', cold: 'juice', sweet: 'sweets' };

const CAFE_TAGS = new Set(['coffee', 'cafe', 'tea']);
const COLD_TAGS = new Set(['juice', 'soft_drinks', 'smoothie', 'cold_drinks']);
const SWEET_TAGS = new Set(['dessert', 'sweets', 'kunafa', 'baklava', 'cake', 'ice_cream']);
const NEUTRAL = new Set(['family', 'new', 'delivery', 'takeaway']);

function tagDoor(tag: string): FoodDoor | null {
  if (NEUTRAL.has(tag)) return null;
  if (CAFE_TAGS.has(tag)) return 'cafe';
  if (COLD_TAGS.has(tag)) return 'cold';
  if (SWEET_TAGS.has(tag)) return 'sweet';
  return 'meal';
}

/** Every door a shop's tags point at (a shop can be more than one; the customer app shows it behind one). */
export function doorsOfTags(tags: readonly string[]): FoodDoor[] {
  const doors = new Set(tags.map(tagDoor).filter((d): d is FoodDoor => d !== null));
  return FOOD_DOORS.filter((d) => doors.has(d));
}

/** The storefront tags after he confirms his doors: his own meal tags stay; each other door adds its tag. */
export function tagsForDoors(doors: readonly FoodDoor[], current: readonly string[]): string[] {
  const keep = current.filter((t) => {
    const d = tagDoor(t);
    return d === null || doors.includes(d);
  });
  const out = [...keep];
  for (const d of FOOD_DOORS) {
    if (!doors.includes(d)) continue;
    if (keep.some((t) => tagDoor(t) === d)) continue;
    out.push(DOOR_TAG[d]);
  }
  return out;
}

/** Drinks only (cafés, juice bars): the app says «مشروب» and «محلك», and drinks start quicker. */
export function drinksOnly(doors: readonly FoodDoor[]): boolean {
  return doors.length > 0 && doors.every((d) => d === 'cafe' || d === 'cold');
}

/**
 * Prep defaults a kind brings where the app already has a knob for it (the store's usual prep time and a
 * new dish's prep time); null keeps what is there. Only fills a store that has none of its own yet.
 */
export function prepDefaultsFor(doors: readonly FoodDoor[]): { storeMinutes: number; dishMinutes: number } | null {
  return drinksOnly(doors) ? { storeMinutes: 5, dishMinutes: 5 } : null;
}

/** The accept sheet's prep choices for a shop's doors (t5): drinks only → 3/5/8; anything with food → 10/15/25. */
export function prepKindOf(doors: readonly FoodDoor[]): PrepKind {
  return drinksOnly(doors) ? 'drinks' : 'food';
}

// ───────────────────────── hours in one tap ─────────────────────────

/**
 * Ready-made schedules (h2): a meal kitchen's usual days, and a café's. «وقت ثاني» is the full hours
 * editor. Ends are local; an end not after its start runs past midnight («12 بالليل» is "00:00").
 */
export const HOURS_PRESETS = {
  lunch_dinner: { start: '11:00', end: '00:00' },
  dinner: { start: '17:00', end: '01:00' },
  breakfast_lunch: { start: '06:00', end: '15:00' },
  all_day: { start: '08:00', end: '00:00' },
  afternoon_night: { start: '14:00', end: '01:00' },
} as const;
export const HoursPreset = z.enum(['lunch_dinner', 'dinner', 'breakfast_lunch', 'all_day', 'afternoon_night']);
export type HoursPreset = z.infer<typeof HoursPreset>;

/** The presets offered for a shop's kinds, the likeliest first. */
export function hoursPresetsFor(doors: readonly FoodDoor[]): HoursPreset[] {
  if (doors.length > 0 && !doors.includes('meal')) return ['afternoon_night', 'all_day', 'dinner'];
  return ['lunch_dinner', 'dinner', 'breakfast_lunch'];
}

/** Friday (h3): after the prayer (the default), like the other days, or closed. */
export const FridayRule = z.enum(['after_prayer', 'same', 'closed']);
export type FridayRule = z.infer<typeof FridayRule>;

const FRIDAY = 5;

/**
 * A preset as the seven days `merchant.setHours` takes. «بعد الصلاة»: a Friday shift that would be open
 * during the prayer starts when it ends instead (the city's prayer pause, e.g. 11:45–13:15); a shift that
 * ends before the prayer, or starts after it, stays.
 */
export function presetDays(preset: HoursPreset, friday: FridayRule, prayer: { start: string; end: string } | null): DayHours[] {
  const shift: HoursShift = { ...HOURS_PRESETS[preset] };
  return Array.from({ length: 7 }, (_, dow) => {
    if (dow !== FRIDAY || friday === 'same') return { dow, shifts: [shift] };
    if (friday === 'closed') return { dow, shifts: [] };
    return { dow, shifts: [afterPrayer(shift, prayer)] };
  });
}

function afterPrayer(shift: HoursShift, prayer: { start: string; end: string } | null): HoursShift {
  if (!prayer) return shift;
  const s = hhmmToMinutes(shift.start);
  const rawEnd = hhmmToMinutes(shift.end);
  const e = rawEnd > s ? rawEnd : rawEnd + 1440;
  const ps = hhmmToMinutes(prayer.start);
  const pe = hhmmToMinutes(prayer.end);
  // Open at any moment of the prayer: start when it ends (if anything is left of the shift).
  if (s < pe && e > ps && e > pe) return { start: prayer.end, end: shift.end };
  return shift;
}

/** The ready-made schedule saves cleanly (every preset × Friday rule; tested). */
export function presetProblems(preset: HoursPreset, friday: FridayRule, prayer: { start: string; end: string } | null) {
  return storeHoursProblems(presetDays(preset, friday, prayer));
}

// ───────────────────────── the API ─────────────────────────

/** Where the activation message sends him (lane D's SMS; WhatsApp later): the setup inside the app. */
export const MERCHANT_SETUP_PATH = '/setup';

export const SetupKindsInput = MerchantOrgInput.extend({
  kinds: z
    .array(z.enum(FOOD_DOORS))
    .min(1)
    .max(FOOD_DOORS.length)
    .refine((k) => new Set(k).size === k.length, { message: 'duplicate kind' }),
});
export type SetupKindsInput = z.infer<typeof SetupKindsInput>;

/** The kitchen runway's checks; `printer_later` is «بعدين، مو لازم» (never red). */
export const SetupCheck = z.enum(['sound', 'screen', 'practice', 'printer_later']);
export type SetupCheck = z.infer<typeof SetupCheck>;
export const SetupCheckInput = MerchantOrgInput.extend({ check: SetupCheck });

export const SetupStartMenuInput = MerchantOrgInput.extend({ uploadIds: z.array(z.string().min(1)).min(1).max(10) });
/** Rows he typed himself (or that the reader found), kept as cards: nothing reaches customers until «صح». */
export const SetupMenuDraftInput = MerchantOrgInput.extend({ jobId: z.string().min(1), items: z.array(ImportedItem).min(1).max(200) });

/** A library photo slug as the bundled files name it («lentil-soup»). */
export const LibrarySlug = z.string().regex(/^[a-z][a-z-]{1,30}$/);

export const SetupAnswerInput = MerchantOrgInput.extend({
  jobId: z.string().min(1),
  index: z.number().int().min(0).max(299),
  /** «صح» puts the dish on the menu (with his fixes below); «مو هذا» leaves it out. */
  answer: z.enum(['ok', 'skip']),
  nameAr: z.string().trim().min(1).max(80).optional(),
  priceIqd: z.number().int().positive().max(10_000_000).optional(),
  categoryAr: z.string().trim().max(40).nullable().optional(),
  /** The photo he kept: his own upload, or the library photo the app uploaded for it. */
  uploadId: z.string().min(1).optional(),
  /** Set when that photo is from Driver's library: customers see «صورة توضيحية» on it. */
  librarySlug: LibrarySlug.optional(),
});
export type SetupAnswerInput = z.infer<typeof SetupAnswerInput>;

export const SetupDishPhotoInput = MerchantOrgInput.extend({
  itemId: z.string().min(1),
  uploadId: z.string().min(1),
  librarySlug: LibrarySlug.nullable().optional(),
});
export const SetupShopPhotoInput = MerchantOrgInput.extend({ uploadId: z.string().min(1) });

export const MenuCard = z.object({
  index: z.number().int(),
  nameAr: z.string(),
  priceIqd: z.number().int(),
  categoryAr: z.string().nullable(),
  description: z.string().nullable(),
  answer: z.enum(['pending', 'ok', 'skip']),
  itemId: z.string().nullable(),
});
export type MenuCard = z.infer<typeof MenuCard>;

export const MenuCards = z.object({
  merchantOrgId: z.string(),
  jobId: z.string().nullable(),
  /** `none`: no menu photos yet · `reading`: photos in, Driver is writing the dishes · `ready`: cards to check · `done`. */
  state: z.enum(['none', 'reading', 'ready', 'done']),
  photos: z.number().int(),
  photoUrls: z.array(z.string()),
  cards: z.array(MenuCard),
});
export type MenuCards = z.infer<typeof MenuCards>;

export const SetupStepView = z.object({ key: SetupStep, done: z.boolean(), seconds: z.number().int() });

export const MerchantSetupView = z.object({
  merchantOrgId: z.string(),
  name: z.string(),
  /** False for shops that never went through setup (every shop before it): nothing shows for them. */
  active: z.boolean(),
  live: z.boolean(),
  liveAt: z.coerce.date().nullable(),
  progress: z.object({
    steps: z.array(SetupStepView),
    percent: z.number().int().min(0).max(100),
    done: z.number().int(),
    total: z.number().int(),
    left: z.number().int(),
    minutesLeft: z.number().int(),
    next: SetupStep.nullable(),
  }),
  kinds: z.object({ confirmed: z.array(z.enum(FOOD_DOORS)).nullable(), suggested: z.array(z.enum(FOOD_DOORS)) }),
  shopPhotoUrl: z.string().nullable(),
  menu: z.object({
    items: z.number().int(),
    withPhoto: z.number().int(),
    libraryPhotos: z.number().int(),
    missingPhotos: z.number().int(),
    pendingCards: z.number().int(),
    cards: MenuCards.shape.state,
  }),
  hours: z.object({ set: z.boolean(), source: z.enum(['store', 'catalog', 'none']) }),
  payout: z.object({ seen: z.boolean() }),
  pickup: z.object({ set: z.boolean() }),
  counter: z.object({ sound: z.boolean(), screen: z.boolean(), practice: z.boolean(), printerLater: z.boolean() }),
  /** The shop's first real order after going live (the gold ribbon), until he has seen it through. */
  firstOrder: z.object({ orderId: z.string(), at: z.coerce.date(), seen: z.boolean() }).nullable(),
});
export type MerchantSetupView = z.infer<typeof MerchantSetupView>;

/** Why going live is refused: the steps still open (`setup_not_ready`). */
export interface MerchantSetupPort {
  get(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView>;
  confirmKinds(actor: Actor, input: SetupKindsInput): Promise<MerchantSetupView>;
  check(actor: Actor, input: z.infer<typeof SetupCheckInput>): Promise<MerchantSetupView>;
  seePayout(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView>;
  shopPhoto(actor: Actor, input: z.infer<typeof SetupShopPhotoInput>): Promise<MerchantSetupView>;
  dishPhoto(actor: Actor, input: z.infer<typeof SetupDishPhotoInput>): Promise<MerchantSetupView>;
  menuCards(actor: Actor, input: MerchantOrgInput): Promise<MenuCards>;
  startMenu(actor: Actor, input: z.infer<typeof SetupStartMenuInput>): Promise<MenuCards>;
  menuDraft(actor: Actor, input: z.infer<typeof SetupMenuDraftInput>): Promise<MenuCards>;
  answer(actor: Actor, input: SetupAnswerInput): Promise<MenuCards>;
  goLive(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView>;
  firstOrderSeen(actor: Actor, input: MerchantOrgInput): Promise<MerchantSetupView>;
}
