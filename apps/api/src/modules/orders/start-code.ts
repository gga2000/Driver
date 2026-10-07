import { randomInt } from 'node:crypto';
import { isGuessableStartCode, isNightAt, START_CODE_RULES, type OrderType } from '@driver/contracts';

/**
 * s1 «رمز المشوار» (ride step 3): the 4 digits a night ride starts with. Drawn from the OS's secure
 * random source, never one a driver could guess without the rider ("1111", "1234", "9876").
 */
export function newStartCode(draw: () => number = () => randomInt(0, 10 ** START_CODE_RULES.length)): string {
  for (;;) {
    const code = String(draw()).padStart(START_CODE_RULES.length, '0');
    if (!isGuessableStartCode(code)) return code;
  }
}

/**
 * The code a new order gets: rides whose pickup is at night (`isNightAt` of the booked time, or of now
 * for a ride wanted now) get one; everything else none.
 */
export function startCodeForNewOrder(type: OrderType, pickupAt: Date, draw?: () => number): string | null {
  return type === 'ride' && isNightAt(pickupAt) ? newStartCode(draw) : null;
}
