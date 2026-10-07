import { START_CODE_RULES, type PartnerJobStop } from '@driver/contracts';

/**
 * s1 «رمز المشوار» (ride step 3) on the driver's side: a night ride's pickup needs the 4 digits the
 * rider reads out before «الراكب صعد». The job only says one is needed; the code itself never reaches
 * this app, so the server is the only one that checks it.
 */

/** True when completing this stop starts a night ride and needs the rider's code. */
export function needsStartCode(stop: Pick<PartnerJobStop, 'type' | 'state' | 'startCodeRequired'> | null, ride: boolean): boolean {
  return Boolean(ride && stop && stop.type === 'pickup' && stop.state !== 'completed' && stop.state !== 'skipped' && stop.startCodeRequired);
}

/** One key on the pad: a digit is added while there is room; `back` takes the last one off. */
export function typeKey(code: string, key: string): string {
  if (key === 'back') return code.slice(0, -1);
  if (!/^\d$/.test(key) || code.length >= START_CODE_RULES.length) return code;
  return code + key;
}

/** The pad's keys in reading order (the last row: an empty slot, 0, back). */
export const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

export function codeComplete(code: string): boolean {
  return code.length === START_CODE_RULES.length && /^\d+$/.test(code);
}
