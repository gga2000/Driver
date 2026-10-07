import { describe, expect, it } from 'vitest';
import type { Order, OrderTracking } from '@driver/contracts';
import { autoSendRating, doorNote, followsInTrackV2, moneyLine, notesFor, paidLine, roadDots, trackMode } from './track-v2';

const at = (hhmm: string) => new Date(`2026-10-07T${hhmm}:00Z`);

type RoadOrder = Parameters<typeof roadDots>[0];
const order = (o: Partial<RoadOrder>): RoadOrder => ({ type: 'food', state: 'placed', acceptedAt: null, preparingAt: null, readyAt: null, pickedUpAt: null, deliveredAt: null, ...o });
const states = (o: RoadOrder) => roadDots(o).map((d) => `${d.key}:${d.state}${d.live ? '*' : ''}`);

describe('roadDots (t4, the four dots from real taps)', () => {
  it('waits on the first dot before the kitchen says yes', () => {
    expect(states(order({}))).toEqual(['accepted:current', 'cooking:todo', 'on_the_way:todo', 'at_you:todo']);
  });

  it('after the yes, cooking is current but still until the kitchen presses «بدأنا»', () => {
    expect(states(order({ state: 'merchant_accepted', acceptedAt: at('17:15') }))).toEqual(['accepted:done', 'cooking:current', 'on_the_way:todo', 'at_you:todo']);
    expect(roadDots(order({ state: 'merchant_accepted', acceptedAt: at('17:15') }))[0]!.at).toEqual(at('17:15'));
  });

  it('breathes on cooking once the kitchen pressed it, and on the road once he has it', () => {
    expect(states(order({ state: 'preparing', acceptedAt: at('17:15'), preparingAt: at('17:16') }))).toEqual(['accepted:done', 'cooking:current*', 'on_the_way:todo', 'at_you:todo']);
    const road = roadDots(order({ state: 'picked_up', acceptedAt: at('17:15'), preparingAt: at('17:16'), readyAt: at('17:28'), pickedUpAt: at('17:31') }));
    expect(road.map((d) => d.state)).toEqual(['done', 'done', 'current', 'todo']);
    expect(road[1]!.at).toEqual(at('17:28'));
    expect(road[2]!.live).toBe(true);
  });

  it('lights every dot once delivered', () => {
    expect(roadDots(order({ state: 'delivered', acceptedAt: at('17:15'), pickedUpAt: at('17:31'), deliveredAt: at('17:40') })).every((d) => d.state === 'done')).toBe(true);
  });
});

describe('trackMode (t1)', () => {
  const view = (o: Partial<Order>, trip: Partial<NonNullable<OrderTracking['trip']>> | null = null) =>
    ({ order: { type: 'food', state: 'placed', pickedUpAt: null, ...o }, trip: trip ? { stops: [], dropsBeforeMine: 0, ...trip } : null }) as unknown as OrderTracking;

  it('shows the kitchen while it cooks, the map on the road, the door, then thanks', () => {
    expect(trackMode(view({ state: 'preparing' }), 'preparing')).toBe('kitchen');
    expect(trackMode(view({ state: 'ready' }), 'at_pickup')).toBe('kitchen');
    expect(trackMode(view({ state: 'picked_up' }, { state: 'in_transit' }), 'on_the_way')).toBe('map');
    expect(trackMode(view({ state: 'picked_up' }, { state: 'arrived_dropoff' }), 'on_the_way')).toBe('door');
    expect(trackMode(view({ state: 'delivered' }), 'arrived')).toBe('thanks');
    expect(trackMode(view({ state: 'customer_cancelled' }), 'cancelled')).toBe('ended');
  });

  it('keeps a reassigned order where its food is', () => {
    expect(trackMode(view({ state: 'ready' }), 'reassigning')).toBe('kitchen');
    expect(trackMode(view({ state: 'picked_up', pickedUpAt: at('17:31') }), 'reassigning')).toBe('map');
  });

  it('follows kitchen orders only (rides keep their screen)', () => {
    expect(followsInTrackV2('food')).toBe(true);
    expect(followsInTrackV2('grocery_catalog')).toBe(true);
    expect(followsInTrackV2('ride')).toBe(false);
    expect(followsInTrackV2('parcel')).toBe(false);
  });
});

describe('moneyLine and paidLine (t3, a2, HUNT-05)', () => {
  it('says the note he will pay with and the change it brings', () => {
    expect(moneyLine({ paymentMethod: 'cash', totalIqd: 17_500, changeIqd: 0, statedTenderIqd: 20_000 })).toEqual({ kind: 'cash', handIqd: 20_000, totalIqd: 17_500, tenderChangeIqd: 2_500, roundedIqd: 0 });
  });

  it('says the total when he named no note', () => {
    expect(moneyLine({ paymentMethod: 'cash', totalIqd: 17_500, changeIqd: 0 })).toMatchObject({ handIqd: 17_500, tenderChangeIqd: 0 });
  });

  it('has nothing to hand over on the wallet', () => {
    expect(moneyLine({ paymentMethod: 'wallet', totalIqd: 17_500, changeIqd: 0 })).toEqual({ kind: 'paid', amountIqd: 17_500 });
  });

  it('after the door: the whole note when the rest went to the wallet, else the total', () => {
    expect(paidLine({ paymentMethod: 'cash', totalIqd: 17_500, changeIqd: 0, statedTenderIqd: 20_000, changeToWalletIqd: 2_500 })).toEqual({ kind: 'cash', paidIqd: 20_000, totalIqd: 17_500, creditedIqd: 2_500 });
    expect(paidLine({ paymentMethod: 'cash', totalIqd: 17_500, changeIqd: 0, statedTenderIqd: 20_000 })).toEqual({ kind: 'cash', paidIqd: 17_500, totalIqd: 17_500, creditedIqd: 0 });
  });
});

describe('notesFor (a2)', () => {
  it('makes 20,000 from two 10,000s (there is no 20,000 note)', () => {
    expect(notesFor(20_000)).toEqual([10_000, 10_000]);
  });

  it('uses the fewest notes', () => {
    expect(notesFor(25_000)).toEqual([25_000]);
    expect(notesFor(15_250)).toEqual([10_000, 5_000, 250]);
  });

  it('gives up on amounts that need many notes or are not notes', () => {
    expect(notesFor(17_500)).toBeNull();
    expect(notesFor(100)).toBeNull();
    expect(notesFor(0)).toBeNull();
  });
});

describe('autoSendRating (r1)', () => {
  it('sends a good score by itself once every asked score is in', () => {
    expect(autoSendRating(5, 4, false)).toBe(true);
    expect(autoSendRating(5, 0, false)).toBe(false);
    expect(autoSendRating(4, null, false)).toBe(true);
  });

  it('waits for «كمّل» on a low score, and never sends twice', () => {
    expect(autoSendRating(3, 5, false)).toBe(false);
    expect(autoSendRating(5, 2, false)).toBe(false);
    expect(autoSendRating(5, 5, true)).toBe(false);
  });
});

describe('doorNote', () => {
  it("reads the saved place's courier hint by its id", () => {
    const places = [{ id: 'p1', note: ' باب أخضر يم جامع الرسول ' }, { id: 'p2', note: null }];
    expect(doorNote({ zoneKey: 'z', placeId: 'p1' }, places)).toBe('باب أخضر يم جامع الرسول');
    expect(doorNote({ zoneKey: 'z', placeId: 'p2' }, places)).toBeNull();
    expect(doorNote({ zoneKey: 'z' }, places)).toBeNull();
    expect(doorNote(null, places)).toBeNull();
  });
});

describe('trackMode after a complaint', () => {
  it('keeps the thank-you card on a delivered order under review, the calm card otherwise', () => {
    const v = (deliveredAt: Date | null) => ({ order: { type: 'food', state: 'disputed', deliveredAt }, trip: null }) as unknown as OrderTracking;
    expect(trackMode(v(new Date('2026-10-07T17:40:00Z')), 'disputed')).toBe('thanks');
    expect(trackMode(v(null), 'disputed')).toBe('ended');
  });
});
