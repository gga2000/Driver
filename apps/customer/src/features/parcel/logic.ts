import { PARCEL_RULES, type ParcelSize, type ParcelState, type ParcelStep } from '@driver/contracts';

/**
 * طرود on the customer's side (Ali, 2026-10-12): the pure rules the send sheet and the parcel page share,
 * kept out of the screens so they run in plain Node tests.
 */

export const PARCEL_SIZES: readonly ParcelSize[] = ['small', 'medium', 'large'];

/** One send attempt's id (`SendParcelInput.clientRequestId`): kept across retries so a repeat returns the same parcel. */
export function newRequestId(random: () => number = Math.random, now: number = Date.now()): string {
  const tail = Array.from({ length: 10 }, () => Math.floor(random() * 36).toString(36)).join('');
  return `parcel-${now.toString(36)}-${tail}`;
}

/**
 * The declared value as typed: digits only (Western or Eastern, commas and spaces allowed), whole دينار.
 * Empty is 0 (nothing declared); anything else that is not a number is null.
 */
export function parseValue(text: string): number | null {
  const western = text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[,،\s]/g, '');
  if (western === '') return 0;
  if (!/^\d{1,7}$/.test(western)) return null;
  return Number(western);
}

/** The value field's problem, if any: over the most a parcel may be worth. */
export function valueProblem(value: number | null): 'too_high' | 'invalid' | null {
  if (value === null) return 'invalid';
  return value > PARCEL_RULES.declaredValueMaxIqd ? 'too_high' : null;
}

/** The words on the tag, trimmed; a problem when empty. */
export function whatProblem(what: string): 'required' | null {
  return what.trim().length === 0 ? 'required' : null;
}

/** A courier is on it or about to be: the live map is worth opening. */
export function isLive(state: ParcelState): boolean {
  return state === 'finding_courier' || state === 'to_pickup' || state === 'on_the_way' || state === 'returning';
}

/** The sender may still call it off: before a courier took it (the server says no after that). */
export function canCancel(state: ParcelState): boolean {
  return state === 'waiting_door' || state === 'finding_courier';
}

/** The page keeps itself fresh while something is still to happen; closed parcels stop asking. */
export function pollMs(state: ParcelState | undefined): number | false {
  if (!state) return false;
  if (state === 'delivered' || state === 'returned' || state === 'cancelled') return false;
  return state === 'waiting_door' ? 20_000 : 10_000;
}

export type StripState = 'done' | 'current' | 'todo';

/** The four moments on the tag's strip: done ones carry their time; the first not done is the current one (unless the parcel closed). */
export function strip(steps: readonly ParcelStep[], state: ParcelState): Array<ParcelStep & { phase: StripState }> {
  const closed = state === 'cancelled' || state === 'returned' || state === 'delivered';
  let currentGiven = closed;
  return steps.map((s) => {
    if (s.at) return { ...s, phase: 'done' as const };
    if (!currentGiven) {
      currentGiven = true;
      return { ...s, phase: 'current' as const };
    }
    return { ...s, phase: 'todo' as const };
  });
}

/** A zone from the city's list as a chip label (Western digits, as the voice guide asks). */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}
