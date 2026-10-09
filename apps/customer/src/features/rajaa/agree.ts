import type { AgreementKind, AgreementView, BookingView } from '@driver/contracts';

/**
 * Step 4 agreed trip prices on the rider's side (docs/specs/2026-10-08-agreed-trip-prices.md): what
 * the booking screen shows for each kind, from the rider's agreements on one departure.
 */
export type AgreementPhase =
  /** Nothing open: show «اسأل السايق». */
  | { phase: 'ask'; last: 'expired' | 'declined' | null }
  /** Asked, the driver hasn't priced it yet. */
  | { phase: 'waiting'; agreement: AgreementView }
  /** The driver named a price: accept or decline. */
  | { phase: 'priced'; agreement: AgreementView }
  /** Agreed and ready to book with (or already on the booking). */
  | { phase: 'agreed'; agreement: AgreementView };

/** The newest agreement of this kind decides; withdrawn ones are as if never asked. */
export function agreementPhase(all: readonly AgreementView[] | undefined, kind: AgreementKind, now: Date = new Date()): AgreementPhase {
  const a = (all ?? []).filter((x) => x.kind === kind && x.state !== 'withdrawn').sort((x, y) => +new Date(y.askedAt) - +new Date(x.askedAt))[0];
  if (!a) return { phase: 'ask', last: null };
  if (a.state === 'asked') return { phase: 'waiting', agreement: a };
  if (a.state === 'proposed') {
    // The server's tick may lag a few seconds: past its time it can't be accepted any more.
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= now.getTime()) return { phase: 'ask', last: 'expired' };
    return { phase: 'priced', agreement: a };
  }
  if (a.state === 'accepted' || a.state === 'used') return { phase: 'agreed', agreement: a };
  return { phase: 'ask', last: a.state === 'declined' ? 'declined' : a.state === 'expired' ? 'expired' : null };
}

/** The name of where he boards: the garage, the meeting point, his agreed spot, or his door. */
export function stopNameOf(
  pickup: Pick<BookingView['pickup'], 'kind' | 'nameAr' | 'note'>,
  garage: string,
  names: { pin: string; door: string; place: (raw: string) => string },
): string {
  if (pickup.kind === 'garage') return garage;
  if (pickup.kind === 'pin') return pickup.note?.trim() || names.pin;
  if (pickup.nameAr) return names.place(pickup.nameAr);
  return names.door;
}
