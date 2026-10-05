import type { BoardCard, DispatchConfig, DispatchStatus } from '@driver/contracts';
import { OPEN_STATES, type OfferRecord } from './dispatch.repository.js';
import type { DispatchRequest } from './dispatch.store.js';

/** Arabic card labels for the Console dispatch board (Iraqi register, voice & microcopy spec). */
export const STATUS_AR: Record<DispatchStatus, string> = {
  scheduled: 'مجدول',
  searching: 'دا ندوّر سايق',
  rebroadcast: 'إعادة بث',
  awaiting_dispatcher: 'ينتظر قرار الديسباتشر',
  needs_dispatcher: 'يحتاج الديسباتشر',
  assigned: 'تعيّن السايق',
  cancelled: 'ملغي',
};

export const compensationLabelAr = (iqd: number) => `+${iqd} تعويض`;

const secondsUntil = (at: number, now: number) => Math.max(0, Math.ceil((at - now) / 1000));

/** One board card from the request state and its offer rows. Pure. */
export function buildCard(r: DispatchRequest, offers: readonly OfferRecord[], cfg: DispatchConfig, now: number): BoardCard {
  return {
    tripId: r.tripId,
    vertical: r.vertical,
    zoneId: r.zoneId,
    policy: r.policy,
    status: r.status,
    status_ar: STATUS_AR[r.status],
    wave: r.wave,
    pass: r.pass,
    elapsedSec: Math.max(0, Math.floor((now - (r.searchStartedAt ?? r.createdAt)) / 1000)),
    countdownSec: r.nextTimerAt === null ? null : secondsUntil(r.nextTimerAt, now),
    red: r.red,
    compensationLabel_ar: r.compensationActive ? compensationLabelAr(cfg.rebroadcastCompensationIqd) : null,
    customerMayCancelFree: r.customerMayCancelFree,
    assignedDriverId: r.assignedDriverId,
    suggestion: r.suggestion,
    offers: offers.map((o) => ({
      offerId: o.id,
      driverId: o.driverId,
      wave: o.wave,
      pass: o.pass,
      state: o.state,
      compensationIqd: o.compensationIqd,
      expiresInSec: OPEN_STATES.includes(o.state) ? secondsUntil(o.expiresAt.getTime(), now) : 0,
    })),
  };
}

/** Red cards first, then oldest first. */
export function sortCards(cards: BoardCard[]): BoardCard[] {
  return cards.sort((a, b) => Number(b.red) - Number(a.red) || b.elapsedSec - a.elapsedSec || a.tripId.localeCompare(b.tripId));
}
