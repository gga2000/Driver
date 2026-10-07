import { searchScore, type PhoneBookingStatus, type PhoneBookingVertical } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import type { ChipTone } from '@/components/ui';

/**
 * Console › حجز بالتلفون (taxi/tuktuk step 4): the form's rules on the client — the same Iraqi mobile
 * rule as the API's `normalizeIraqiPhone`, the landmark search, and what is still missing before
 * «احجز». The server checks everything again.
 */

/** Arabic-Indic and Persian digits → 0–9 (people read numbers out in either). */
function westernDigits(raw: string): string {
  return raw.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

/** `0770 123 4567`, `770…`, `964…`, `+964…`, `00964…` → `+9647701234567`; null when it is not an Iraqi mobile. */
export function callerPhone(raw: string): string | null {
  const digits = westernDigits(raw).replace(/\D/g, '');
  const national = digits.startsWith('00964') ? digits.slice(5) : digits.startsWith('964') ? digits.slice(3) : digits.startsWith('0') ? digits.slice(1) : digits;
  return /^7\d{9}$/.test(national) ? `+964${national}` : null;
}

/** What staff type, shown as `07XX XXX XXXX` (how Iraqis write a number); a pasted `+964…` turns local. */
export function formatCallerPhone(raw: string): string {
  const digits = westernDigits(raw).replace(/\D/g, '');
  let local = digits;
  if (digits.startsWith('00964')) local = `0${digits.slice(5)}`;
  else if (digits.startsWith('964')) local = `0${digits.slice(3)}`;
  else if (digits.startsWith('7')) local = `0${digits}`;
  local = local.slice(0, 11);
  return [local.slice(0, 4), local.slice(4, 7), local.slice(7, 11)].filter(Boolean).join(' ');
}

export interface PlaceChoice {
  id: string;
  name_ar: string;
  aliases_ar?: readonly string[];
  kind?: string;
}

/**
 * Landmarks matching what staff typed — the name or any other name people use («الجامع» finds «باب
 * الجامع الكبير»), however the hamza or taa marbuta were typed — best match first, at most `limit`.
 * An empty query lists them in their own order.
 */
export function filterPlaces<T extends PlaceChoice>(places: readonly T[], query: string, limit = 8): T[] {
  const q = query.trim();
  if (!q) return places.slice(0, limit);
  return places
    .map((p, i) => ({ p, i, score: Math.max(searchScore(q, p.name_ar), ...(p.aliases_ar ?? []).map((a) => searchScore(q, a) - 0.5)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p);
}

export interface PhoneBookingForm {
  phone: string;
  name: string;
  pickupId: string | null;
  dropoffId: string | null;
  vertical: PhoneBookingVertical;
  note: string;
}

export type MissingPart = 'phone' | 'name' | 'places' | 'quote';

/** What still stands between the form and «احجز», in the order staff fill it. */
export function missingParts(form: PhoneBookingForm, quoted: boolean): MissingPart[] {
  const out: MissingPart[] = [];
  if (!callerPhone(form.phone)) out.push('phone');
  if (!form.name.trim()) out.push('name');
  if (!form.pickupId || !form.dropoffId || form.pickupId === form.dropoffId) out.push('places');
  else if (!quoted) out.push('quote');
  return out;
}

export const MISSING_KEY: Record<MissingPart, MessageKey> = {
  phone: 'console.phone.missing_phone',
  name: 'console.phone.missing_name',
  places: 'console.phone.missing_places',
  quote: 'console.phone.missing_quote',
};

export const STATUS_KEY: Record<PhoneBookingStatus, MessageKey> = {
  searching: 'console.phone.status_searching',
  driver_coming: 'console.phone.status_driver_coming',
  driver_arrived: 'console.phone.status_driver_arrived',
  on_trip: 'console.phone.status_on_trip',
  done: 'console.phone.status_done',
  cancelled: 'console.phone.status_cancelled',
};

/** Searching is the one to watch (nobody took it yet); a driver on it is live; finished is quiet. */
export function statusTone(status: PhoneBookingStatus): ChipTone {
  switch (status) {
    case 'searching':
      return 'warn';
    case 'driver_coming':
    case 'driver_arrived':
    case 'on_trip':
      return 'live';
    case 'done':
      return 'done';
    case 'cancelled':
      return 'neutral';
  }
}

export const VEHICLE_KEY: Record<PhoneBookingVertical, MessageKey> = { taxi: 'console.phone.taxi', tuktuk: 'console.phone.tuktuk' };

/** One booking attempt's retry key: re-sent on a retry so a double click books one ride. */
export function newBookingKey(random: () => number = Math.random): string {
  return `phone-${Date.now().toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}
