import type { DriverDocumentKind, DriverDocumentStatus, FleetDay, FleetDriver, FleetDriverState, VehicleClass } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { toWesternDigits } from '@/lib/phone';
import { pluralForm } from '../work/logic';

/**
 * Pure rules behind the fleet owner screens (plain Node: no React Native here, unit-tested).
 */

/** Baghdad is UTC+3 all year (no DST): the server's "local" day. */
const BAGHDAD_OFFSET_MS = 3 * 3_600_000;

/** `YYYY-MM-DD` of the Baghdad calendar day `at` falls on (matches `FleetDay.date`). */
export function localDateKey(at: Date): string {
  return new Date(at.getTime() + BAGHDAD_OFFSET_MS).toISOString().slice(0, 10);
}

/** Day of week 0 (Sunday) … 6 of a `YYYY-MM-DD` key. */
export function dowOf(dateKey: string): number {
  return new Date(`${dateKey}T12:00:00Z`).getUTCDay();
}

export const DOW_KEY: readonly MessageKey[] = [
  'partner.fleet_dow_0',
  'partner.fleet_dow_1',
  'partner.fleet_dow_2',
  'partner.fleet_dow_3',
  'partner.fleet_dow_4',
  'partner.fleet_dow_5',
  'partner.fleet_dow_6',
];
export const DOW_SHORT_KEY: readonly MessageKey[] = [
  'partner.fleet_dow_short_0',
  'partner.fleet_dow_short_1',
  'partner.fleet_dow_short_2',
  'partner.fleet_dow_short_3',
  'partner.fleet_dow_short_4',
  'partner.fleet_dow_short_5',
  'partner.fleet_dow_short_6',
];

export type BarState = 'past' | 'today' | 'future';

export interface WeekBar {
  date: string;
  dow: number;
  earningsIqd: number;
  jobs: number;
  state: BarState;
  /** 0–1 of the tallest day (the chart's scale); 0 for days with no earnings. */
  share: number;
}

/** The week chart: each day's bar against the best day, with today and the days still to come marked. */
export function weekBars(days: readonly FleetDay[], today: string): WeekBar[] {
  const max = Math.max(0, ...days.map((d) => d.earningsIqd));
  return days.map((d) => ({
    date: d.date,
    dow: dowOf(d.date),
    earningsIqd: d.earningsIqd,
    jobs: d.jobs,
    state: d.date === today ? 'today' : d.date > today ? 'future' : 'past',
    share: max > 0 ? Math.max(0, d.earningsIqd) / max : 0,
  }));
}

/** Rounded "nice" ceiling for the chart's single gridline label (25,000 · 50,000 · 100,000 …). */
export function niceCeiling(n: number): number {
  if (n <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

export const CLASS_KEY: Record<VehicleClass, MessageKey> = {
  bike: 'partner.fleet_class_bike',
  tuktuk: 'partner.fleet_class_tuktuk',
  car: 'partner.fleet_class_car',
  suv: 'partner.fleet_class_suv',
  van: 'partner.fleet_class_van',
  intercity: 'partner.fleet_class_intercity',
};

/** What a fleet owner can register here (intercity cars go through the garage board). */
export const FLEET_CLASSES: readonly VehicleClass[] = ['bike', 'tuktuk', 'car', 'suv', 'van'];

/** Default passenger seats per class (edge-case §9: saloon 4, SUV 6, van 7/11), as the API defaults. */
export const DEFAULT_SEATS: Record<VehicleClass, number> = { bike: 0, tuktuk: 3, car: 4, suv: 6, van: 7, intercity: 4 };
export const MAX_SEATS: Record<VehicleClass, number> = { bike: 0, tuktuk: 4, car: 4, suv: 7, van: 14, intercity: 7 };

/** "4 مقاعد" / "11 مقعد" / "مقعد واحد"; null for no seats (a bike). */
export function seatsKey(n: number): MessageKey | null {
  const form = pluralForm(n);
  if (form === 'zero') return null;
  return ({ one: 'partner.fleet_seats_one', few: 'partner.fleet_seats_few', many: 'partner.fleet_seats_many' } as const)[form];
}

/** "واسط  ١٢٣٤٥ " → "واسط 12345": Western digits, single spaces. */
export function normalizePlate(raw: string): string {
  return toWesternDigits(raw).replace(/\s+/g, ' ').trim();
}

/** A plate needs at least a few characters and a number in it. */
export function isPlateValid(raw: string): boolean {
  const p = normalizePlate(raw);
  return p.length >= 3 && p.length <= 20 && /\d/.test(p);
}

export const DOC_KEY: Record<DriverDocumentKind, MessageKey> = {
  national_id_front: 'partner.fleet_doc_national_id_front',
  national_id_back: 'partner.fleet_doc_national_id_back',
  licence: 'partner.fleet_doc_licence',
  vehicle_registration: 'partner.fleet_doc_vehicle_registration',
  insurance: 'partner.fleet_doc_insurance',
  photo: 'partner.fleet_doc_photo',
};

/** The expiry alert line for one document. */
export function docAlertKey(status: DriverDocumentStatus, daysToExpiry: number | null): MessageKey {
  if (status === 'expired' || (daysToExpiry !== null && daysToExpiry < 0)) return 'partner.fleet_doc_expired';
  if (daysToExpiry === 0) return 'partner.fleet_doc_today';
  return 'partner.fleet_doc_days';
}

export const DOCS_STATUS_KEY: Record<DriverDocumentStatus, MessageKey> = {
  approved: 'partner.fleet_docs_ok',
  expiring: 'partner.fleet_docs_expiring',
  expired: 'partner.fleet_docs_expired',
  pending: 'partner.fleet_docs_pending',
  rejected: 'partner.fleet_docs_rejected',
};

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export const STATE_KEY: Record<FleetDriverState, MessageKey> = {
  offline: 'partner.fleet_state_offline',
  online: 'partner.fleet_state_online',
  on_job: 'partner.fleet_state_on_job',
  over_cap: 'partner.fleet_state_over_cap',
};
export const STATE_TONE: Record<FleetDriverState, Tone> = { offline: 'neutral', online: 'success', on_job: 'info', over_cap: 'danger' };

const STATE_ORDER: Record<FleetDriverState, number> = { over_cap: 0, on_job: 1, online: 2, offline: 3 };

/** Who needs a look first: over the cap, then working, then online; within a group, most earned today. */
export function sortDrivers<T extends Pick<FleetDriver, 'state' | 'todayEarningsIqd' | 'name' | 'driverId'>>(drivers: readonly T[]): T[] {
  return [...drivers].sort(
    (a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.todayEarningsIqd - a.todayEarningsIqd || (a.name ?? a.driverId).localeCompare(b.name ?? b.driverId, 'ar'),
  );
}

/** Cash bar tone: green under 80 % of the cap, amber from 80 %, red over it (money §4). */
export function cashTone(heldIqd: number, capIqd: number, overCap: boolean): 'success' | 'warning' | 'danger' {
  if (overCap || (capIqd > 0 && heldIqd > capIqd)) return 'danger';
  if (capIqd > 0 && heldIqd / capIqd >= 0.8) return 'warning';
  return 'success';
}

/** "+964 77*****50" → "0770 ••• ••50" style is the vault's job; we only keep the mask LTR-isolated. */
export function maskedPhone(masked: string | null): string {
  return masked ? `⁦${masked}⁩` : '';
}
