import { AZIZIYAH_ZONES, type DeliveryPoint, type MenuCategory, type MenuItem, type MenuModifierGroup } from '@driver/contracts';
import type { AvailabilityWindow, CatalogItemRecord } from './catalog.repository.js';

/**
 * Pure pieces of the customer catalog read (M3): open/closed from opening hours and pause windows,
 * prep and ETA ranges, menu sections and the item view. No I/O; `catalog.rpc.ts` composes them.
 */

export const STOREFRONT_RULES = {
  /** Busy mode adds this to prep (the same buffer `CatalogService.prepTime` uses). */
  busyBufferMin: 10,
  /** Width of the prep and ETA ranges shown on cards. */
  rangeMin: 10,
  /** Courier speed in town and the road-over-straight-line factor (draft until trails calibrate it). */
  courierKmh: 20,
  roadFactor: 1.35,
  /** Pickup at the counter + hand-over at the door. */
  handoverMin: 5,
  defaultPrepMin: 20,
} as const;

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** A local weekly window `{dow, start, end}` (end before start wraps past midnight). */
type Window = Pick<AvailabilityWindow, 'dow' | 'start' | 'end'>;

const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local day-of-week and minute-of-day at `at` in `timeZone` (same rule as orders' pause windows). */
export function localDowMinutes(at: Date, timeZone: string): { dow: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dow: DOW[get('weekday')] ?? at.getUTCDay(), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** The window `at` falls in, if any. */
export function activeWindow<W extends Window>(at: Date, windows: readonly W[], timeZone: string): W | null {
  const { dow, minutes } = localDowMinutes(at, timeZone);
  for (const w of windows) {
    const s = toMinutes(w.start);
    const e = toMinutes(w.end);
    if (s <= e) {
      if (w.dow === dow && minutes >= s && minutes < e) return w;
    } else if ((w.dow === dow && minutes >= s) || ((w.dow + 1) % 7 === dow && minutes < e)) {
      return w;
    }
  }
  return null;
}

/** "17:30" → "5:30", "00:00" → "12:00" (voice guide §5: 12-hour clock). */
export function twelveHour(hhmm: string): string {
  const total = toMinutes(hhmm);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`;
}

/** Start of the next opening window after `at` (local), within a week; null when there is none. */
export function nextOpening(at: Date, hours: readonly AvailabilityWindow[], timeZone: string): string | null {
  const { dow, minutes } = localDowMinutes(at, timeZone);
  let best: { inMin: number; start: string } | null = null;
  for (const w of hours) {
    const dayOffset = (w.dow - dow + 7) % 7;
    for (const extra of [0, 7]) {
      const inMin = (dayOffset + extra) * 1440 + toMinutes(w.start) - minutes;
      if (inMin <= 0) continue;
      if (!best || inMin < best.inMin) best = { inMin, start: w.start };
      break;
    }
  }
  return best ? twelveHour(best.start) : null;
}

export interface OpenState {
  open: boolean;
  closedReason: 'hours' | 'paused' | null;
  opensAt: string | null;
}

/** Open when inside an opening window (or no hours on file) and outside every pause window. */
export function openState(at: Date, hours: readonly AvailabilityWindow[], pauses: readonly Window[], timeZone: string): OpenState {
  if (hours.length > 0 && !activeWindow(at, hours, timeZone)) return { open: false, closedReason: 'hours', opensAt: nextOpening(at, hours, timeZone) };
  const pause = activeWindow(at, pauses, timeZone);
  if (pause) return { open: false, closedReason: 'paused', opensAt: twelveHour(pause.end) };
  return { open: true, closedReason: null, opensAt: null };
}

/** Typical prep: the storefront's figure, else the median of the menu's prep times, else 20. */
export function basePrepMin(storefrontPrep: number | null, items: ReadonlyArray<Pick<CatalogItemRecord, 'prepTimeMin'>>): number {
  if (storefrontPrep !== null && storefrontPrep > 0) return storefrontPrep;
  const sorted = items.map((i) => i.prepTimeMin).sort((a, b) => a - b);
  if (sorted.length === 0) return STOREFRONT_RULES.defaultPrepMin;
  return sorted[Math.floor(sorted.length / 2)]!;
}

export function prepRange(base: number, busy: boolean): { min: number; max: number } {
  const min = base + (busy ? STOREFRONT_RULES.busyBufferMin : 0);
  return { min, max: min + STOREFRONT_RULES.rangeMin };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** A point's pin, else its zone's centroid (Aziziyah seed). */
export function pinOf(p: DeliveryPoint): { lat: number; lng: number } | null {
  if (p.pin) return p.pin;
  const z = AZIZIYAH_ZONES.find((x) => x.id === p.zoneKey);
  return z ? { lat: z.lat, lng: z.lng } : null;
}

/** Courier minutes from kitchen to door: straight line × road factor at town speed, plus hand-over. */
export function rideMinutes(from: DeliveryPoint, to: DeliveryPoint): number | null {
  const a = pinOf(from);
  const b = pinOf(to);
  if (!a || !b) return null;
  const km = haversineKm(a, b) * STOREFRONT_RULES.roadFactor;
  return Math.round((km / STOREFRONT_RULES.courierKmh) * 60) + STOREFRONT_RULES.handoverMin;
}

/** Prep + ride, the low end rounded up to 5 minutes; the range is as wide as the prep range. */
export function etaRange(prep: { min: number; max: number }, ride: number | null): { min: number; max: number } | null {
  if (ride === null) return null;
  const min = Math.ceil((prep.min + ride) / 5) * 5;
  return { min, max: min + (prep.max - prep.min) };
}

function isGroupVariant(g: CatalogItemRecord['modifierGroups'][number]): boolean {
  const min = Math.max(g.minSelect, g.required ? 1 : 0);
  return min === 1 && g.maxSelect === 1 && g.modifiers.some((m) => m.priceIqd > 0);
}

export function menuItemView(item: CatalogItemRecord, at: Date, timeZone: string): MenuItem {
  const soldOut = !item.available || item.stock === 0;
  const outOfSchedule = item.availability.length > 0 && activeWindow(at, item.availability, timeZone) === null;
  const groups: MenuModifierGroup[] = item.modifierGroups.map((g) => ({
    id: g.id,
    name: g.nameAr,
    required: g.required,
    min: Math.max(g.minSelect, g.required ? 1 : 0),
    max: Math.max(1, g.maxSelect),
    variant: isGroupVariant(g),
    modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.nameAr, priceIqd: m.priceIqd, available: m.available })),
  }));
  // Variants first: the sheet reads "which version" before "what on it".
  groups.sort((a, b) => Number(b.variant) - Number(a.variant));
  return {
    id: item.id,
    name: item.nameAr,
    description: item.description,
    priceIqd: item.priceIqd,
    photoUrl: item.photoUrl,
    available: !soldOut && !outOfSchedule,
    unavailableReason: soldOut ? 'sold_out' : outOfSchedule ? 'schedule' : null,
    prepTimeMin: item.prepTimeMin,
    pointsEligible: item.pointsEligible,
    modifierGroups: groups,
  };
}

/** Sections in menu order (first item of each); items without a section go last under `otherLabel`. */
export function menuSections(items: readonly CatalogItemRecord[], at: Date, timeZone: string, otherLabel = 'أصناف ثانية'): MenuCategory[] {
  const sections = new Map<string, MenuItem[]>();
  const loose: MenuItem[] = [];
  for (const item of items) {
    const view = menuItemView(item, at, timeZone);
    if (!item.categoryAr) {
      loose.push(view);
      continue;
    }
    const list = sections.get(item.categoryAr) ?? [];
    list.push(view);
    sections.set(item.categoryAr, list);
  }
  const out: MenuCategory[] = [...sections.entries()].map(([name, list], i) => ({ id: `cat_${i + 1}`, name, items: list }));
  if (loose.length) out.push({ id: `cat_${out.length + 1}`, name: otherLabel, items: loose });
  return out;
}

/** Arabic search folding: no diacritics or tatweel, one alef, ة→ه, ى→ي, گ→ك, چ→ج. */
export function foldArabic(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/گ/g, 'ك')
    .replace(/چ/g, 'ج')
    .toLowerCase()
    .trim();
}
