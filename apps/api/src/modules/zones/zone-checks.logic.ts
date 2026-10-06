import { pointInRing, ZONE_CHECK_RULES, type LatLng, type ZoneCheckTally } from '@driver/contracts';
import type { ZoneCheckAnswerRow } from './zone-checks.repository.js';
import type { ZoneRecord } from './zones.repository.js';

const MINUTE_MS = 60_000;

/** When an unanswered question stops being shown (and stops accepting an answer). */
export function checkExpiresAt(askedAt: Date): Date {
  return new Date(askedAt.getTime() + ZONE_CHECK_RULES.answerWithinMin * MINUTE_MS);
}

/** True while the question can still be answered: after that he has driven on. */
export function checkIsOpen(askedAt: Date, now: Date): boolean {
  return now.getTime() < checkExpiresAt(askedAt).getTime();
}

/**
 * The zone to ask about: the placed outline that holds the courier's own arrival fix. Drafts (the AI
 * hexagons) have nothing drawn to confirm and confirmed zones are done, so neither is asked. Outlines
 * never overlap (the zone tool refuses it), so at most one holds the point.
 */
export function zoneToAsk(zones: readonly ZoneRecord[], fix: LatLng): ZoneRecord | null {
  return zones.find((z) => z.active !== false && z.placement === 'placed' && z.placedAt !== null && pointInRing(fix, z.ring)) ?? null;
}

/**
 * Drivers' answers about one outline. "ما أعرف" counts neither way; `drivers` counts the different
 * drivers behind the "yes" answers, because three yeses from one driver is one opinion, not three.
 * A "no" the team has marked «تم الفحص» no longer counts (Ali, 2026-10-06): they went and looked, and
 * the outline is right. The yeses stay: they were about the same outline the team just vouched for.
 */
export function tallyChecks(rows: readonly ZoneCheckAnswerRow[]): ZoneCheckTally {
  const yes = rows.filter((r) => r.answer === 'yes');
  const no = rows.filter((r) => r.answer === 'no' && r.clearedAt === null);
  const flaggedAt = no.reduce<Date | null>((latest, r) => (latest === null || r.answeredAt.getTime() > latest.getTime() ? r.answeredAt : latest), null);
  return { yes: yes.length, no: no.length, drivers: new Set(yes.map((r) => r.driverId)).size, flaggedAt };
}

/**
 * The outline is confirmed by `yesToConfirm` yeses from `distinctDrivers`+ drivers, and only while no
 * driver has said "لا" about it: a "no" holds it for the field team, who either fix the outline (which
 * starts the count again) or mark it «تم الفحص», rather than letting later yeses outvote it.
 */
export function confirmsZone(tally: ZoneCheckTally): boolean {
  return tally.no === 0 && tally.yes >= ZONE_CHECK_RULES.yesToConfirm && tally.drivers >= ZONE_CHECK_RULES.distinctDrivers;
}
