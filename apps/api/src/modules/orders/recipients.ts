import type { Order } from '@driver/contracts';
import type { ResolvedParticipant } from './participants.js';
import type { ParticipantRecord } from './orders.repository.js';
import type { OrdersRidersPort } from './riders.js';

/**
 * SEC-14: the name a sender gives the person who receives his order (a gift «عزيمة», or food sent to
 * someone else) is personal data about a third party. It never lands on `participants.label`
 * (public); it lives in the vault next to the riders' names (`participant_identities`, keyed by the
 * participant id) and every read goes through identity's logged `participantNames`. The vault row's
 * person is the recipient when they have an account, else the orderer who named them.
 */

/** The public row's label: a recipient's is never kept (the name goes to the vault). */
export function publicLabel(p: Pick<ResolvedParticipant, 'role' | 'label'>): string | null {
  return p.role === 'recipient' ? null : p.label;
}

/** Keeps each recipient's name in the vault, in the placing unit of work (matched in order of creation). */
export async function rememberRecipients(port: OrdersRidersPort | null, created: readonly ParticipantRecord[], typed: readonly ResolvedParticipant[], ordererId: string): Promise<void> {
  if (!port) return;
  const names = typed.filter((p) => p.role === 'recipient').map((p) => p.label?.trim() ?? '');
  const rows = created.filter((p) => p.role === 'recipient');
  for (const [i, p] of rows.entries()) {
    const name = names[i];
    if (name) await port.remember(p.id, { personId: p.personId ?? ordererId, phoneHash: p.phoneHash, name }, ordererId);
  }
}

/** The recipient participants of `orders` whose names a reader may need. */
export function recipientIds(orders: readonly Order[]): string[] {
  return orders.flatMap((o) => o.participants.filter((p) => p.role === 'recipient').map((p) => p.id));
}

/** The orders with each recipient's label filled from the vault names read for this reader. */
export function withRecipientLabels(orders: Order[], names: Record<string, string | null>): Order[] {
  return orders.map((o) =>
    o.participants.some((p) => p.role === 'recipient' && names[p.id])
      ? { ...o, participants: o.participants.map((p) => (p.role === 'recipient' && names[p.id] ? { ...p, label: names[p.id]! } : p)) }
      : o,
  );
}
