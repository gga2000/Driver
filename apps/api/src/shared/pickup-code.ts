import { createHmac, randomBytes } from 'node:crypto';
import { PICKUP_CODE_DIGITS } from '@driver/contracts';

/**
 * The code a courier shows at the kitchen counter (maps program r4): four digits from an HMAC of the
 * order and the courier, so it cannot be guessed from the ticket, needs no storage, and changes when
 * the order is reassigned (the first courier's code stops matching).
 */
export function pickupCode(orderId: string, courierId: string, secret: string): string {
  const h = createHmac('sha256', secret).update(`pickup:${orderId}:${courierId}`).digest();
  return String(h.readUInt32BE(0) % 10 ** PICKUP_CODE_DIGITS).padStart(PICKUP_CODE_DIGITS, '0');
}

/** A per-process secret when none is configured (codes then differ between instances — dev only). */
const SECRET = process.env['PICKUP_CODE_SECRET'] ?? process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex');

/** The code with this deployment's secret: the partner job, the kitchen board and the handover agree. */
export function pickupCodeFor(orderId: string, courierId: string): string {
  return pickupCode(orderId, courierId, SECRET);
}
