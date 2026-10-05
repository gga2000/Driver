/**
 * No duplicate orders (offline work). Every checkout attempt carries one idempotency key
 * (`orders.place` → `clientRequestId`); the server answers a repeated key with the order it already
 * placed. The app makes the key when "اطلب" is tapped and keeps it until the outcome is known:
 *
 * - placed → the key is done (the next order gets a new one);
 * - refused by the server for a reason it named (`price_changed`, `wallet_insufficient`…) → nothing was
 *   placed; the key is dropped;
 * - anything else (the network dropped, a timeout, a server failure): the order may or may not exist.
 *   The key is kept — persisted with the cart — and the next tap, or the app itself once the network
 *   is back, re-sends it: the server places the order once or answers with the one it placed.
 *
 * Pure (plain Node tests): no react-native imports.
 */

export interface PlaceAttempt {
  /** The `clientRequestId` sent with every try of this attempt. */
  key: string;
  /** What the attempt orders (`attemptSignature`): a different basket is a different attempt. */
  signature: string;
  /** When the outcome became unknown (ms); null while the first try is in flight. */
  unknownSince: number | null;
}

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh key: `chk_` + time + 12 random characters — matches the server's `[A-Za-z0-9_-]{8,64}`. */
export function newRequestKey(prefix = 'chk', now: number = Date.now(), random: () => number = Math.random): string {
  let r = '';
  for (let i = 0; i < 12; i++) r += KEY_CHARS[Math.floor(random() * KEY_CHARS.length) % KEY_CHARS.length];
  return `${prefix}_${now.toString(36)}_${r}`;
}

/**
 * What an attempt orders: the kitchen and the dishes (item, choices, person, note, quantity). Payment,
 * time and recipient are not in it: switching from cash to wallet after a lost answer must not turn
 * one order into two.
 */
export function attemptSignature(merchantId: string, lines: ReadonlyArray<{ key: string; qty: number }>): string {
  return `${merchantId}|${lines
    .map((l) => `${l.key}×${l.qty}`)
    .sort()
    .join(',')}`;
}

/** The attempt for a tap: the pending one when it orders the same thing, otherwise a new one. */
export function attemptFor(pending: PlaceAttempt | null, signature: string, makeKey: () => string = () => newRequestKey()): PlaceAttempt {
  if (pending && pending.signature === signature) return pending;
  return { key: makeKey(), signature, unknownSince: null };
}

/**
 * True when the server refused the order for a reason it named: the API's own error codes are
 * lower-case (`price_changed`, `deal_changed`, `wallet_insufficient`, `rate_limited`…). tRPC's
 * transport codes (`INTERNAL_SERVER_ERROR`, `TIMEOUT`) and no code at all (the network) are not:
 * the order may exist.
 */
export function refusedForSure(code: string | null): boolean {
  return code !== null && /^[a-z][a-z0-9_]*$/.test(code);
}

/** What the screen does with a failed try: drop the key (refused) or keep it (outcome unknown). */
export function afterFailure(attempt: PlaceAttempt, code: string | null, now: number = Date.now()): PlaceAttempt | null {
  if (refusedForSure(code)) return null;
  return { ...attempt, unknownSince: attempt.unknownSince ?? now };
}

/**
 * Whether the app re-sends the pending attempt by itself: its outcome is unknown, the network is back
 * and nothing is in flight. Only within `maxAgeMs` (default 30 min): an attempt left that long is the
 * person's to retry, not the app's.
 */
export function shouldReplay(pending: PlaceAttempt | null, opts: { online: boolean; inFlight: boolean; now?: number; maxAgeMs?: number }): boolean {
  if (!pending || pending.unknownSince === null || !opts.online || opts.inFlight) return false;
  return (opts.now ?? Date.now()) - pending.unknownSince <= (opts.maxAgeMs ?? 30 * 60_000);
}
