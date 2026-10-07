import { z } from 'zod';
import { Vertical } from './common.js';

/**
 * Taxi/tuktuk safety at night and after the ride (ride step 3, Ali's yes on s1, s2, s7 and d3):
 *
 *  - s1 «رمز المشوار»: a ride placed for the night (`isNightAt` of its pickup time) gets 4 digits the
 *    rider tells the driver before getting in. The trip cannot start without them: the partner's
 *    «الراكب صعد» (`trips.completeStop` on the ride's pickup) carries `startCode`, a wrong one is
 *    refused, and `START_CODE_RULES.wrongAlertAt` wrong ones on one pickup put a row on the Console
 *    safety strip. Only the orderer and the rider ever see the code (`OrderTracking.trip.startCode`);
 *    the driver's job only says one is needed.
 *  - s2 «وصل بالسلامة»: when a ride that ended at night is completed, the rider's trusted people who
 *    have the app get a push (nothing goes outside the app).
 *  - s7 «نسيت غرض»: up to `CHAT_LOST_ITEM_H` after a completed ride the customer reopens the chat with
 *    the driver (`chat.lostItem`).
 *  - d3 «السايق قريب، اطلع هسة»: one push per ride when the one ETA puts the driver
 *    `RIDE_NEAR_RULES.etaSec` from the pickup.
 */

export const START_CODE_RULES = {
  /** Digits in the code. */
  length: 4,
  /** Wrong codes typed on one pickup that alert ops on the Console safety strip, once. */
  wrongAlertAt: 5,
  /** An alert stays on the Console strip this long after it was raised. */
  alertShowMin: 60,
} as const;

/** The 4 digits the rider reads out ("4821"). */
export const StartCode = z.string().regex(/^\d{4}$/);
export type StartCode = z.infer<typeof StartCode>;

/**
 * A code a driver could guess without the rider: one digit repeated ("1111") or a straight run up or
 * down ("1234", "9876"). The server never hands one out.
 */
export function isGuessableStartCode(code: string): boolean {
  if (!/^\d+$/.test(code) || code.length < 2) return true;
  const d = [...code].map(Number);
  const steps = new Set(d.slice(1).map((x, i) => x - d[i]!));
  return steps.size === 1 && [0, 1, -1].includes([...steps][0]!);
}

/** d3: the "come out now" push goes once, when the one ETA to the pickup is this many seconds or fewer. */
export const RIDE_NEAR_RULES = {
  etaSec: 60,
  /** The ETA is only asked for within this straight-line distance of the pickup (a road call per fix otherwise). */
  checkWithinM: 1500,
} as const;

// ───────────────────────── Console safety strip ─────────────────────────

/**
 * A night ride's trip code typed wrong `START_CODE_RULES.wrongAlertAt` times on one pickup: a row on
 * the Console safety strip (with the خطوط sweep and الرجعة PIN rows) for `alertShowMin`. The driver's
 * name and masked number are one logged vault read for the staff member asking; the code itself never
 * reaches the Console.
 */
export const StartCodeAlert = z.object({
  /** The pickup stop the codes were typed on. */
  alertId: z.string(),
  cityId: z.string(),
  orderId: z.string(),
  tripId: z.string(),
  vertical: Vertical,
  driver: z.object({
    personId: z.string(),
    /** "حيدر ك."; null when the vault has no name. */
    displayName: z.string().nullable(),
    phoneMasked: z.string().nullable(),
  }),
  /** Wrong codes on this pickup so far (the alert was raised at `wrongAlertAt`). */
  wrongCount: z.number().int().min(1),
  raisedAt: z.coerce.date(),
  /** The rider got in afterwards with the right code (the row turns calm); null while not. */
  startedAt: z.coerce.date().nullable(),
});
export type StartCodeAlert = z.infer<typeof StartCodeAlert>;

export const StartCodeAlertsInput = z.object({ cityId: z.string().min(1) });
export type StartCodeAlertsInput = z.infer<typeof StartCodeAlertsInput>;
