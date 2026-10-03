import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { localDateKey, nextLocalMidnight } from '../../shared/local-time.js';

export const HANDOVER_SECRET = Symbol('HANDOVER_SECRET');

/** HANDOVER_CODE_SECRET, else JWT_SECRET (one secret on a dev box), else a per-process random one. */
export function handoverSecretFromEnv(): string {
  return process.env['HANDOVER_CODE_SECRET'] ?? process.env['JWT_SECRET'] ?? randomBytes(32).toString('hex');
}

/**
 * The courier's daily cash hand-over code (money §4 field-ops round): 4 digits from an HMAC of his
 * id and the Baghdad local date. Stateless: his app shows it (`driverAccount.handoverCode`), field
 * ops type what he reads out (`ops.recordCashReceipt`), the server recomputes it. Rotates at local
 * midnight; yesterday's code is refused.
 */
export class HandoverCodes {
  constructor(private readonly secret: string) {}

  code(driverId: string, at: Date): { code: string; validUntil: Date } {
    const mac = createHmac('sha256', this.secret).update(`handover:${driverId}:${localDateKey(at)}`).digest();
    const n = mac.readUInt32BE(0) % 10_000;
    return { code: n.toString().padStart(4, '0'), validUntil: nextLocalMidnight(at) };
  }

  verify(driverId: string, code: string, at: Date): boolean {
    const want = Buffer.from(this.code(driverId, at).code);
    const got = Buffer.from(code);
    return want.length === got.length && timingSafeEqual(want, got);
  }
}
