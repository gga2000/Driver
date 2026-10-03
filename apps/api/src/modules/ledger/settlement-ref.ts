import { createHash } from 'node:crypto';

/**
 * Settlement references (edge-case G-82). Partner shows the driver (or Merchant the owner) a short
 * reference to type into the ZainCash note; finance matches incoming transfers on the reference
 * first, on amount ± 500 second, and sends the rest to a manual queue.
 */

/** Crockford base32 without I, L, O, U: easy to read aloud and type on a phone. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function settlementReference(party: 'D' | 'M', partyId: string, at: Date, seq = 0): string {
  const day = at.toISOString().slice(0, 10);
  const digest = createHash('sha256').update(`${party}|${partyId}|${day}|${seq}`).digest();
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[(digest[i] ?? 0) % 32];
  return `${party}-${code.slice(0, 4)}-${code.slice(4)}`;
}

export interface OpenSettlement {
  reference: string;
  partyId: string;
  expectedIqd: number;
}

export interface IncomingTransfer {
  amountIqd: number;
  /** Free text the sender typed in the ZainCash note. */
  note: string;
}

export type MatchResult =
  | { by: 'reference'; settlement: OpenSettlement }
  | { by: 'amount'; settlement: OpenSettlement }
  | { by: 'manual'; candidates: OpenSettlement[] };

const normalize = (s: string) => s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

export function matchTransfer(transfer: IncomingTransfer, open: readonly OpenSettlement[], toleranceIqd = 500): MatchResult {
  const note = normalize(transfer.note);
  const byRef = open.find((s) => note.includes(normalize(s.reference)));
  if (byRef) return { by: 'reference', settlement: byRef };
  const near = open.filter((s) => Math.abs(s.expectedIqd - transfer.amountIqd) <= toleranceIqd);
  if (near.length === 1 && near[0]) return { by: 'amount', settlement: near[0] };
  return { by: 'manual', candidates: near };
}
