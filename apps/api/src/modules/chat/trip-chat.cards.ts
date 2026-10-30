import type { EventsService } from '../events/index.js';
import type { TripChatSubjects } from '../routes/index.js';
import type { NewTripCard, TripChatService } from './trip-chat.service.js';

export const TRIP_CARDS_SUBSCRIBER = 'chat:trip_cards';

/** The routes events that put a card in a Baghdad/Kut chat (step 4c). */
export const TRIP_CARD_EVENTS = ['agreement.asked', 'agreement.proposed', 'request.cash_asked'] as const;

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);

/**
 * Outbox subscriber (private car round 2 step 4c): each price asked or named on a run, and each
 * «احجز وادفع كاش» ask on a private-car offer, becomes a card in the pair's chat, which pushes the
 * other side. Chat only shows them: the agreement or offer stays the record, and the card reads its
 * state when the thread is read. An event whose trip is gone writes nothing.
 */
export function registerTripCards(events: EventsService, subjects: TripChatSubjects, chat: TripChatService): () => void {
  return events.subscribe(TRIP_CARDS_SUBSCRIBER, TRIP_CARD_EVENTS, async (event) => {
    const p = event.payload;
    const base = { actorId: event.actorId, eventId: event.id, at: event.occurredAt };
    if (event.type === 'request.cash_asked') {
      const requestId = str(p['requestId']) ?? event.aggregateId;
      const offerId = str(p['offerId']);
      const target = offerId ? await subjects.cardTarget('request', requestId, { driverId: str(p['driverId']) }) : null;
      if (!target || !offerId) return;
      await chat.writeCard(target, { ...base, kind: 'cash_reservation', refId: offerId, amountIqd: int(p['noShowIqd']) });
      return;
    }
    const agreementId = str(p['agreementId']);
    const departureId = str(p['departureId']) ?? event.aggregateId;
    const kind = p['kind'] === 'pin_pickup' || p['kind'] === 'door_drop' ? p['kind'] : null;
    if (!agreementId || !kind) return;
    const target = await subjects.cardTarget('departure', departureId, { riderId: str(p['riderId']) });
    if (!target) return;
    const card: NewTripCard =
      event.type === 'agreement.asked'
        ? { ...base, kind, refId: agreementId, amountIqd: null }
        : { ...base, kind, refId: agreementId, amountIqd: int(p['amountIqd']) ?? 0 };
    await chat.writeCard(target, card);
  });
}
