import type { PartnerJobStop, QuickReplyKey } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import type { TFn } from '@/lib/i18n';

/**
 * The job screen's step rules (partner redesign j1, j2, j10, r5, r6): pure, unit-tested, behind
 * `app/job.tsx` and the chat.
 */

/** j1: the four places of a job on the rail, in order. */
export type RailStage = 0 | 1 | 2 | 3;

export const RAIL_KEYS: Record<'food' | 'ride', readonly [MessageKey, MessageKey, MessageKey, MessageKey]> = {
  food: ['partner.rail_kitchen', 'partner.rail_pickup', 'partner.rail_customer', 'partner.rail_handover'],
  ride: ['partner.rail_rider', 'partner.rail_board', 'partner.rail_road', 'partner.rail_drop'],
};

/** j1: where the current stop stands — on the way to the pickup, at it, on the way to the drop-off, at it. */
export function railStage(stop: Pick<PartnerJobStop, 'type' | 'state'> | null): RailStage {
  if (!stop) return 3;
  const pickup = stop.type !== 'dropoff';
  const at = stop.state === 'arrived';
  return pickup ? (at ? 1 : 0) : at ? 3 : 2;
}

/** The moment the screen is in: one per stop and state, so a prompt is said once per moment. */
export function stepKey(stop: Pick<PartnerJobStop, 'stopId' | 'state'> | null): string {
  return stop ? `${stop.stopId}:${stop.state}` : 'none';
}

/**
 * j2: what helps him find the stop, the way people here say it — the customer's own words first
 * («باب أخضر، يم جامع الرسول»), else the saved place's note; the landmark the customer chose, else the
 * nearest public one. A pickup has no note; its landmark still helps.
 */
export function doorHint(stop: Pick<PartnerJobStop, 'type' | 'note' | 'door' | 'landmark'>): { note: string | null; noteFromPlace: boolean; landmark: string | null } {
  const drop = stop.type === 'dropoff';
  const own = drop ? (stop.note?.trim() || null) : null;
  const placeNote = drop ? (stop.door?.placeNote?.trim() || null) : null;
  return {
    note: own ?? placeNote,
    noteFromPlace: !own && Boolean(placeNote),
    landmark: (drop ? stop.door?.landmark : null) ?? stop.landmark ?? null,
  };
}

/** Digits read one by one («4 6 0 5»), so a voice says a code, not a number. */
export function spokenDigits(code: string): string {
  return code.split('').join(' ');
}

/**
 * j10: the line read aloud when a step begins — «وصلت لمطعم خالد، وري الرمز 4605». Null when there is
 * nothing worth saying.
 */
export function stepSpeech(stop: PartnerJobStop | null, place: string, ride: boolean, t: TFn, locale: string): string | null {
  if (!stop) return null;
  const sep = locale === 'en' ? ', ' : '، ';
  const near = (s: Pick<PartnerJobStop, 'type' | 'note' | 'door' | 'landmark'>) => {
    const l = doorHint(s).landmark;
    return l ? t('partner.say_near', { name: l }) : null;
  };
  const parts: (string | null)[] = [];
  const pickup = stop.type !== 'dropoff';
  if (pickup && stop.state === 'pending') parts.push(t(ride ? 'partner.say_go_rider' : 'partner.say_go_pickup', { place }), near(stop));
  else if (pickup && stop.state === 'arrived') {
    if (ride) parts.push(t('partner.say_at_rider'));
    else parts.push(t('partner.say_at_pickup', { place }), stop.pickupCode ? t('partner.say_show_code', { code: spokenDigits(stop.pickupCode) }) : null);
  } else if (!pickup && stop.state === 'pending') parts.push(t(ride ? 'partner.say_go_destination' : 'partner.say_go_dropoff', { place }), near(stop));
  else if (!pickup && stop.state === 'arrived') {
    parts.push(t(ride ? 'partner.say_at_destination' : 'partner.say_at_dropoff'));
    if (stop.collectIqd > 0) parts.push(t('partner.say_take_cash', { amount: String(stop.collectIqd) }));
  }
  const said = parts.filter((p): p is string => Boolean(p));
  return said.length ? said.join(sep) : null;
}

/** r6: the rider-waiting clock from the arrival, «3:07» (display only; any waiting fee is a money rule). */
export function waitClock(arrivedAt: Date | null, now: number): { minutes: number; text: string } | null {
  if (!arrivedAt) return null;
  const s = Math.max(0, Math.floor((now - arrivedAt.getTime()) / 1000));
  return { minutes: Math.floor(s / 60), text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
}

/**
 * r5 / b11: the chat's one-tap messages for the step he is at — only the ones that are true right now,
 * likeliest first, at most three, so they fit without being cut at the edge. Only keys the server
 * offered; with the step unknown, the server's own list.
 */
export function stepReplies(offered: readonly QuickReplyKey[], kind: string, ride: boolean, stage: RailStage | null, max = 3): QuickReplyKey[] {
  if (stage === null) return offered.slice(0, max);
  const want: readonly QuickReplyKey[] =
    kind === 'merchant_courier'
      ? stage === 0
        ? ['courier_five_min', 'courier_how_long']
        : stage === 1
          ? ['courier_at_restaurant', 'courier_how_long']
          : []
      : stage === 0
        ? ride
          ? ['courier_two_min', 'courier_cant_find']
          : []
        : stage === 1
          ? ride
            ? ['courier_outside', 'courier_cant_find']
            : []
          : stage === 2
            ? ride
              ? []
              : ['courier_two_min', 'courier_on_the_way', 'courier_cant_find']
            : ride
              ? []
              : ['courier_at_door', 'courier_cant_find'];
  return want.filter((k) => offered.includes(k)).slice(0, max);
}
