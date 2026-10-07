import { GARAGE_TAXI_RULES, type GarageArmView, type GarageTaxiLink, type ToGaragePlan } from '@driver/contracts';

/** The cards re-read their plan this often while they show (the car's minutes and the ride move). */
export const GARAGE_TAXI_POLL_MS = 30_000;
/** The live screen's late notice follows the server's look (once a minute) at half that. */
export const LATE_NOTICE_POLL_MS = 30_000;

/** What a card's query gave: data (possibly kept from before), or still loading, or failed. */
export interface CardQuery<T> {
  data: T | undefined;
  isError: boolean;
}

/**
 * The x2 card's state. Without data: loading, offline or the error (with a retry). With data: the
 * offer, the booked ride, «احفظ بيتك» (no saved place) or «ما يلحگ» (too late); a seat the idea does
 * not apply to (not leaving Aziziyah, not booked, a door pickup, the car left) hides the card.
 */
export type ToGarageCardWaiting = { kind: 'loading' | 'error' | 'offline' | 'hidden' };
export type ToGarageCardShown = { kind: 'offer' | 'booked' | 'no_place' | 'too_late'; plan: ToGaragePlan; offline: boolean };
export type ToGarageCardState = ToGarageCardWaiting | ToGarageCardShown;

export function toGarageCardState(q: CardQuery<ToGaragePlan>, online: boolean): ToGarageCardState {
  const plan = q.data;
  if (!plan) return { kind: !online ? 'offline' : q.isError ? 'error' : 'loading' };
  const offline = !online;
  if (plan.status === 'offer') return { kind: 'offer', plan, offline };
  if (plan.status === 'booked') return { kind: 'booked', plan, offline };
  if (plan.unavailable === 'no_place') return { kind: 'no_place', plan, offline };
  if (plan.unavailable === 'too_late') return { kind: 'too_late', plan, offline };
  return { kind: 'hidden' };
}

/** The x4 card's state, the same way: a seat the idea does not apply to (or one that arrived) hides it. */
export type ArmCardWaiting = { kind: 'loading' | 'error' | 'offline' | 'hidden' };
export type ArmCardShown = { kind: 'off' | 'armed' | 'placed' | 'dropped' | 'failed' | 'no_place'; view: GarageArmView; offline: boolean };
export type ArmCardState = ArmCardWaiting | ArmCardShown;

/** The card has something to show (a plan or a view), not a placeholder. */
export function hasPlan(state: ToGarageCardState): state is ToGarageCardShown {
  return 'plan' in state;
}
export function hasView(state: ArmCardState): state is ArmCardShown {
  return 'view' in state;
}

export function armCardState(q: CardQuery<GarageArmView>, online: boolean): ArmCardState {
  const view = q.data;
  if (!view) return { kind: !online ? 'offline' : q.isError ? 'error' : 'loading' };
  const offline = !online;
  if (view.status === 'unavailable') return view.unavailable === 'no_place' ? { kind: 'no_place', view, offline } : { kind: 'hidden' };
  return { kind: view.status, view, offline };
}

/** x3: the live screen shows the notice once the taxi would bring him `lateTellMin`+ after the car's time. */
export function lateNoticeShown(link: GarageTaxiLink | null | undefined): link is GarageTaxiLink {
  return !!link && link.lateMin >= GARAGE_TAXI_RULES.lateTellMin;
}
