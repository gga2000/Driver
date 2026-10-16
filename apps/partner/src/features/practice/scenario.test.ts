import { describe, expect, it } from 'vitest';
import { answerPractice, type PracticeStore } from './practice-link';
import { arrive, complete, newPractice, practiceKindFor, practiceStep, practiceTip, respond, ring, type PracticeState } from './scenario';

const T0 = 1_000_000;

function store(s: PracticeState | null): PracticeStore & { s: PracticeState | null } {
  const box = {
    s,
    get: () => box.s,
    set: (next: PracticeState) => {
      box.s = next;
    },
  };
  return box;
}

describe('practice order (l4)', () => {
  it('picks food for a bike, a ride for a car or a tuktuk, nothing for intercity', () => {
    expect(practiceKindFor('bike')).toBe('food');
    expect(practiceKindFor('car')).toBe('taxi');
    expect(practiceKindFor('tuktuk')).toBe('tuktuk');
    expect(practiceKindFor('intercity')).toBeNull();
    expect(practiceKindFor(null)).toBeNull();
  });

  it('rings with the real ring time and walks the four job steps to done', () => {
    let s = ring(newPractice('food', T0), T0);
    expect(s.offer?.ringSec).toBe(15);
    expect(practiceStep(s)).toBe(1);
    expect(practiceTip(s)).toBe('partner.practice_tip_offer');
    s = respond(s, true, T0 + 6_000);
    expect(s.stage).toBe('job');
    expect(s.learned.acceptedInSec).toBe(6);
    expect(practiceStep(s)).toBe(2);
    s = arrive(s, 'practice-pickup', T0 + 10_000);
    expect(practiceTip(s)).toBe('partner.practice_tip_picked_up');
    s = complete(s, 'practice-pickup', {}, T0 + 20_000);
    expect(s.job?.currentStopId).toBe('practice-dropoff');
    expect(practiceStep(s)).toBe(4);
    s = arrive(s, 'practice-dropoff', T0 + 30_000);
    expect(practiceTip(s)).toBe('partner.practice_tip_door');
    s = complete(s, 'practice-dropoff', { cashCollectedIqd: 14_000, note: 'handover_photo_on_device' }, T0 + 200_000);
    expect(s.stage).toBe('done');
    expect(s.job?.state).toBe('completed');
    expect(s.learned).toMatchObject({ cashIqd: 14_000, paidWithIqd: 20_000, photo: true });
  });

  it('a declined or rung-out order goes back to ring again; nothing is accepted late', () => {
    const s = ring(newPractice('taxi', T0), T0);
    expect(s.offer?.ringSec).toBe(20);
    expect(respond(s, false, T0 + 1_000).stage).toBe('idle');
    expect(respond(s, true, T0 + 21_000).stage).toBe('idle');
  });

  it('answers the screens from the phone and refuses any other write', () => {
    const box = store(ring(newPractice('food', T0), T0));
    expect(answerPractice(box, 'partner.currentOffer', undefined, T0)).toMatchObject({ vertical: 'food' });
    expect(answerPractice(box, 'partner.activeJob', undefined, T0)).toBeNull();
    answerPractice(box, 'dispatch.respond', { offerId: 'x', accept: true }, T0 + 3_000);
    expect(box.s?.stage).toBe('job');
    const trip = answerPractice(box, 'trips.arrive', { tripId: 't', stopId: 'practice-pickup' }, T0 + 4_000) as { stops: { id: string; state: string }[] };
    expect(trip.stops[0]).toMatchObject({ id: 'practice-pickup', state: 'arrived' });
    expect(() => answerPractice(box, 'places.photoUpload', {}, T0)).toThrow();
    expect(() => answerPractice(box, 'safety.raise', {}, T0)).toThrow();
  });

  it('a rung-out offer is gone on the next read', () => {
    const box = store(ring(newPractice('food', T0), T0));
    expect(answerPractice(box, 'partner.currentOffer', undefined, T0 + 16_000)).toBeNull();
    expect(box.s?.stage).toBe('idle');
  });

  it('a late accept is refused like a real one (offer_expired)', () => {
    const box = store(ring(newPractice('food', T0), T0));
    try {
      answerPractice(box, 'dispatch.respond', { accept: true }, T0 + 16_000);
      expect.unreachable();
    } catch (err) {
      expect((err as { data?: { code?: string } }).data?.code).toBe('offer_expired');
    }
  });
});
