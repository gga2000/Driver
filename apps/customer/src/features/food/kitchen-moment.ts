import type { PublicSeason } from '@driver/contracts';
import { ME, TABLE, groupByPerson, type CartState } from './cart';

/**
 * "The kitchen says yes" (joy o14, audit F-06/F-07/S-5) as plain data: the waiting screen's three
 * real steps, what the accept moment does to the senses on this day, the order's lines by person
 * (so Umm Ali sees the kids' notes went through), and the delivery time shown as a clock.
 */

export type WaitingStepKey = 'sent' | 'confirm' | 'cooking';
export type StepState = 'done' | 'current' | 'todo';

export interface WaitingStep {
  key: WaitingStepKey;
  state: StepState;
}

/**
 * The mini timeline under the kitchen drawing, from real events only: the order reached the kitchen
 * (placed), the kitchen confirms (accepted), it is being made. Never a fake progress bar.
 */
export function waitingSteps(accepted: boolean): WaitingStep[] {
  return accepted
    ? [
        { key: 'sent', state: 'done' },
        { key: 'confirm', state: 'done' },
        { key: 'cooking', state: 'current' },
      ]
    : [
        { key: 'sent', state: 'done' },
        { key: 'confirm', state: 'current' },
        { key: 'cooking', state: 'todo' },
      ];
}

/** How long the "{kitchen} قبل طلبك · يوصلك تقريباً 7:42 م" card stays before tracking opens. */
export const ACCEPT_HOLD_MS = 1200;
/** The ring closing in success colour before the card (skipped under reduced motion). */
export const ACCEPT_RING_MS = 500;

export interface AcceptFeedback {
  haptic: 'success' | 'medium';
  cue: 'accepted' | null;
  /** Ring sweep and cross-fade; false under reduced motion (an instant swap). */
  animate: boolean;
  holdMs: number;
}

/**
 * The accept moment on this day: a success buzz and the soft "accepted" sound, or on a quiet day
 * (Console mourning days, J1a) a plain buzz and no sound. Reduced motion swaps instantly but keeps
 * the hold: the line has to be readable either way.
 */
export function acceptFeedback(today: Pick<PublicSeason, 'celebrations' | 'sounds'>, reduceMotion: boolean): AcceptFeedback {
  return {
    haptic: today.celebrations ? 'success' : 'medium',
    cue: today.sounds ? 'accepted' : null,
    animate: !reduceMotion,
    holdMs: ACCEPT_HOLD_MS,
  };
}

export interface PersonLines {
  personId: string;
  /** «للسفرة» (shared dishes), the orderer ("إلي") or a person by name. */
  kind: 'table' | 'me' | 'person';
  /** Null for the table and the orderer. */
  name: string | null;
  /** "لفة تكة ×2 · بدون بصل" — one entry per line, the note after a dot. */
  lines: string[];
}

/** The placed cart's lines by person, each with its kitchen note. */
export function linesByPerson(cart: CartState): PersonLines[] {
  return groupByPerson(cart).groups.map((g) => ({
    personId: g.personId,
    kind: g.personId === TABLE ? 'table' : g.personId === ME ? 'me' : 'person',
    name: g.personId === ME || g.personId === TABLE ? null : (g.person?.name ?? null),
    lines: g.lines.map((l) => {
      const dish = l.qty > 1 ? `${l.name} ×${l.qty}` : l.name;
      return l.note ? `${dish} · ${l.note}` : dish;
    }),
  }));
}

const MIN = 60_000;
/** Ride from the kitchen to the door when the pins are not known. */
export const FALLBACK_RIDE_MIN = 10;
/** Pickup at the counter and the hand-over at the door (the card's own `handoverMin`). */
const HANDOVER_MIN = 5;

/**
 * When the food should reach the door once the kitchen accepted: its promised ready time (never
 * before now) plus the ride and the hand-over, rounded up to 5 minutes — "يوصلك تقريباً 7:45 م".
 */
export function acceptedEta(i: { now: Date; promisedReadyAt: Date | null; rideMin: number | null }): Date {
  const ready = Math.max(i.now.getTime(), i.promisedReadyAt?.getTime() ?? i.now.getTime());
  const at = ready + ((i.rideMin ?? FALLBACK_RIDE_MIN) + HANDOVER_MIN) * MIN;
  const step = 5 * MIN;
  return new Date(Math.ceil(at / step) * step);
}

/** After this long without an answer the screen says so honestly (audit F-07). */
export const SLOW_ANSWER_MS = 45_000;

/** The kitchen has had the order for 45 s and not answered yet. */
export function answerIsSlow(offeredAt: Date, now: number): boolean {
  return now - offeredAt.getTime() >= SLOW_ANSWER_MS;
}
