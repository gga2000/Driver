import { AZIZIYAH_ZONES, type LatLng, type OpsTaskKind, type SettlementMode } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { groupDigits } from '@/lib/money';
import { normalizeIraqiPhone, toWesternDigits } from '@/lib/phone';
import { pluralForm } from '../work/logic';

/**
 * Pure rules behind Ops mode (plain Node: no React Native here, unit-tested): the hand-over code
 * pad, the amount field, task due labels, zone lookups, the onboarding wizard's gates and the
 * receipt's clock.
 */

// ───────────────────────── cash hand-over ─────────────────────────

/** The courier's daily hand-over code (`driverAccount.handoverCode`). */
export const CODE_LENGTH = 4;

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'del';

/** The code after one keypad press: digits fill up to 4, `del` removes the last. */
export function pressKey(code: string, key: PadKey): string {
  if (key === 'del') return code.slice(0, -1);
  return code.length >= CODE_LENGTH ? code : `${code}${key}`;
}

/** "25,000" / "٢٥٠٠٠" / "25 000" typed → 25000; 0 when nothing usable was typed. */
export function parseAmount(raw: string): number {
  const digits = toWesternDigits(raw).replace(/\D/g, '');
  if (!digits) return 0;
  return Math.min(Number(digits), 99_999_999);
}

/** As the person types: grouped digits ("25,000"), empty for 0. */
export function amountInput(raw: string): string {
  const n = parseAmount(raw);
  return n > 0 ? groupDigits(n) : '';
}

export type AmountProblem = 'empty' | 'over' | null;

/** The receipt can't exceed what the courier holds (`cash_receipt_exceeds_held` server side too). */
export function amountProblem(amountIqd: number, heldIqd: number): AmountProblem {
  if (amountIqd <= 0) return 'empty';
  if (amountIqd > heldIqd) return 'over';
  return null;
}

/** Ready to confirm: a valid amount and all four code digits. */
export function canConfirmCash(amountIqd: number, heldIqd: number, code: string): boolean {
  return amountProblem(amountIqd, heldIqd) === null && code.length === CODE_LENGTH && /^\d{4}$/.test(code);
}

/** Quick amounts: everything he holds, then round sums below it. */
export function quickAmounts(heldIqd: number): number[] {
  const out = [heldIqd];
  for (const v of [100_000, 50_000, 25_000, 10_000]) if (v < heldIqd && out.length < 3) out.push(v);
  return out.filter((v) => v > 0);
}

/** A retry-safe key per hand-over attempt (`idempotencyKey`, 8–128 chars). */
export function receiptKey(courierId: string, amountIqd: number, nonce: string): string {
  return `ops-cash:${courierId}:${amountIqd}:${nonce}`.slice(0, 128);
}

// ───────────────────────── receipt clock ─────────────────────────

const BAGHDAD_OFFSET_MS = 3 * 3_600_000;

/** Baghdad wall clock "9:42 م" (12-hour, Western digits; ص before noon). */
export function baghdadClock(at: Date, locale: 'ar-IQ' | 'en' = 'ar-IQ'): string {
  const local = new Date(at.getTime() + BAGHDAD_OFFSET_MS);
  const h24 = local.getUTCHours();
  const h = h24 % 12 || 12;
  const m = String(local.getUTCMinutes()).padStart(2, '0');
  const pm = h24 >= 12;
  return locale === 'en' ? `${h}:${m} ${pm ? 'PM' : 'AM'}` : `${h}:${m} ${pm ? 'م' : 'ص'}`;
}

/** Baghdad calendar date "3/10/2026" (day/month/year, as Iraqis write it). */
export function baghdadDate(at: Date): string {
  const local = new Date(at.getTime() + BAGHDAD_OFFSET_MS);
  return `${local.getUTCDate()}/${local.getUTCMonth() + 1}/${local.getUTCFullYear()}`;
}

// ───────────────────────── tasks ─────────────────────────

export const TASK_KIND_KEY: Record<OpsTaskKind, MessageKey> = {
  cash_collection: 'partner.ops_kind_cash_collection',
  merchant_followup: 'partner.ops_kind_merchant_followup',
  landmark_photo: 'partner.ops_kind_landmark_photo',
  document_check: 'partner.ops_kind_document_check',
};

export type Due = 'overdue' | 'today' | 'tomorrow' | null;

/** When a stored task is due, on the Baghdad calendar. */
export function dueOf(dueAt: Date | null, now: Date): Due {
  if (!dueAt) return null;
  if (dueAt.getTime() < now.getTime()) return 'overdue';
  const day = (d: Date) => Math.floor((d.getTime() + BAGHDAD_OFFSET_MS) / 86_400_000);
  const diff = day(dueAt) - day(now);
  if (diff <= 0) return 'today';
  if (diff === 1) return 'tomorrow';
  return null;
}

export const DUE_KEY: Record<Exclude<Due, null>, MessageKey> = {
  overdue: 'partner.ops_task_overdue',
  today: 'partner.ops_task_due_today',
  tomorrow: 'partner.ops_task_due_tomorrow',
};

// ───────────────────────── photos & zones ─────────────────────────

/** "بدون صور" / "صورة وحدة" / "3 صور" / "12 صورة". */
export function photosKey(n: number): MessageKey {
  return ({ zero: 'partner.ops_photos_zero', one: 'partner.ops_photos_one', few: 'partner.ops_photos_few', many: 'partner.ops_photos_many' } as const)[pluralForm(n)];
}

export interface ZoneOption {
  id: string;
  name: string;
  tier: string;
  centre: LatLng;
}

/** Aziziyah's zones for pickers: centre first, then by distance band, names with Western digits. */
export function zoneOptions(locale: 'ar-IQ' | 'en' = 'ar-IQ'): ZoneOption[] {
  return AZIZIYAH_ZONES.map((z) => ({ id: z.id, name: locale === 'en' ? z.name_en : toWesternDigits(z.name_ar), tier: z.tier, centre: { lat: z.lat, lng: z.lng } }));
}

function km(a: LatLng, b: LatLng): number {
  const r = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** The zone a GPS fix falls in, by nearest seed centroid minus its radius (the server re-checks). */
export function nearestZone(pin: LatLng): string | null {
  let best: { id: string; d: number } | null = null;
  for (const z of AZIZIYAH_ZONES) {
    const d = km(pin, { lat: z.lat, lng: z.lng }) - z.radiusM / 1000;
    if (!best || d < best.d) best = { id: z.id, d };
  }
  return best && best.d <= 15 ? best.id : null;
}

// ───────────────────────── merchant onboarding ─────────────────────────

/** In the order the wizard offers them; the city default first (money §4: nightly by the courier). */
export const SETTLEMENT_MODES: readonly SettlementMode[] = ['nightly_courier', 'on_demand', 'daily_zaincash', 'weekly_bulk'];
export const DEFAULT_SETTLEMENT: SettlementMode = 'nightly_courier';

export const SETTLE_KEY: Record<SettlementMode, { title: MessageKey; sub: MessageKey }> = {
  nightly_courier: { title: 'partner.ops_ob_settle_nightly_courier', sub: 'partner.ops_ob_settle_nightly_courier_sub' },
  on_demand: { title: 'partner.ops_ob_settle_on_demand', sub: 'partner.ops_ob_settle_on_demand_sub' },
  daily_zaincash: { title: 'partner.ops_ob_settle_daily_zaincash', sub: 'partner.ops_ob_settle_daily_zaincash_sub' },
  weekly_bulk: { title: 'partner.ops_ob_settle_weekly_bulk', sub: 'partner.ops_ob_settle_weekly_bulk_sub' },
};

export type OnboardStep = 'shop' | 'contact' | 'location' | 'menu' | 'settle' | 'review';
export const ONBOARD_STEPS: readonly OnboardStep[] = ['shop', 'contact', 'location', 'menu', 'settle', 'review'];

export const STEP_KEY: Record<OnboardStep, MessageKey> = {
  shop: 'partner.ops_ob_s_shop',
  contact: 'partner.ops_ob_s_contact',
  location: 'partner.ops_ob_s_location',
  menu: 'partner.ops_ob_s_menu',
  settle: 'partner.ops_ob_s_settle',
  review: 'partner.ops_ob_s_review',
};

export interface OnboardDraft {
  name: string;
  type: 'restaurant' | 'grocer';
  contactName: string;
  contactPhone: string;
  zoneKey: string | null;
  pin: LatLng | null;
  /** Local photos (uri) with their upload id once uploaded. */
  menuPhotos: Array<{ uri: string; uploadId: string | null }>;
  settlementMode: SettlementMode;
  notes: string;
}

export function emptyDraft(): OnboardDraft {
  return { name: '', type: 'restaurant', contactName: '', contactPhone: '', zoneKey: null, pin: null, menuPhotos: [], settlementMode: DEFAULT_SETTLEMENT, notes: '' };
}

/** Whether the wizard may move past `step` with this draft. */
export function stepReady(step: OnboardStep, d: OnboardDraft): boolean {
  switch (step) {
    case 'shop':
      return d.name.trim().length >= 2;
    case 'contact':
      return d.contactName.trim().length >= 1 && normalizeIraqiPhone(d.contactPhone) !== null;
    case 'location':
      return d.zoneKey !== null;
    case 'menu':
      return d.menuPhotos.every((p) => p.uploadId !== null);
    case 'settle':
      return true;
    case 'review':
      return ONBOARD_STEPS.slice(0, -1).every((s) => stepReady(s, d));
  }
}

/** The `ops.merchantOnboarding` input from a finished draft. */
export function onboardingInput(d: OnboardDraft, cityId = 'aziziyah') {
  const phone = normalizeIraqiPhone(d.contactPhone);
  if (!phone || !d.zoneKey) throw new Error('draft_incomplete');
  return {
    cityId,
    name: d.name.trim(),
    type: d.type,
    contact: { name: d.contactName.trim(), phone },
    location: { zoneKey: d.zoneKey, ...(d.pin ? { pin: d.pin } : {}) },
    menuPhotoUploadIds: d.menuPhotos.map((p) => p.uploadId).filter((id): id is string => id !== null),
    settlementMode: d.settlementMode,
    ...(d.notes.trim() ? { notes: d.notes.trim() } : {}),
  };
}

/** Local names for a landmark: trimmed, de-duplicated, at most 5 (the API's limit). */
export function addLocalName(names: readonly string[], raw: string): string[] {
  const n = raw.trim().replace(/\s+/g, ' ');
  if (!n || names.includes(n) || names.length >= 5) return [...names];
  return [...names, n.slice(0, 60)];
}
