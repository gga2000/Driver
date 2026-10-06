import { describe, expect, it } from 'vitest';
import { EMPTY_CART, ME, addLine, type CartMerchant, type CartState } from './cart';
import { ACCEPT_HOLD_MS, acceptFeedback, acceptedEta, answerIsSlow, linesByPerson, waitingSteps } from './kitchen-moment';

describe('answerIsSlow', () => {
  it('says so from 45 s', () => {
    const at = new Date('2026-10-06T16:00:00Z');
    expect(answerIsSlow(at, at.getTime() + 44_000)).toBe(false);
    expect(answerIsSlow(at, at.getTime() + 45_000)).toBe(true);
  });
});

const KHALID: CartMerchant = { id: 'org_1', name: 'مطعم خالد', cityId: 'aziziyah', pickup: { zoneKey: 'street_30' }, minOrderIqd: 5000 };

describe('waitingSteps: three real steps, never a fake bar', () => {
  it('waiting: sent is done, the kitchen confirming is current', () => {
    expect(waitingSteps(false).map((s) => `${s.key}:${s.state}`)).toEqual(['sent:done', 'confirm:current', 'cooking:todo']);
  });
  it('accepted: confirm done, cooking current', () => {
    expect(waitingSteps(true).map((s) => `${s.key}:${s.state}`)).toEqual(['sent:done', 'confirm:done', 'cooking:current']);
  });
});

describe('acceptFeedback: the yes on this day', () => {
  it('a normal day: success buzz, the accepted sound, animated, held 1.2 s', () => {
    expect(acceptFeedback({ celebrations: true, sounds: true }, false)).toEqual({ haptic: 'success', cue: 'accepted', animate: true, holdMs: 1200 });
  });
  it('a quiet day: a plain buzz and no sound', () => {
    expect(acceptFeedback({ celebrations: false, sounds: false }, false)).toMatchObject({ haptic: 'medium', cue: null });
  });
  it('reduced motion: no animation, but the line is still held', () => {
    expect(acceptFeedback({ celebrations: true, sounds: true }, true)).toMatchObject({ animate: false, holdMs: ACCEPT_HOLD_MS });
  });
});

describe('linesByPerson', () => {
  it('groups lines by person with their notes, the orderer first', () => {
    let cart: CartState = EMPTY_CART;
    const sara = { id: 'pp_1', name: 'سارة', phone: null };
    const add = (line: Parameters<typeof addLine>[2], person?: typeof sara) => {
      const r = addLine(cart, KHALID, line, person ? { person } : {});
      if (r.ok) cart = r.cart;
    };
    add({ itemId: 'a', name: 'لفة تكة', basePriceIqd: 2500, modifiers: [], qty: 1, note: 'بدون بصل', personId: sara.id }, sara);
    add({ itemId: 'b', name: 'شوربة عدس', basePriceIqd: 1000, modifiers: [], qty: 2, note: null, personId: ME });
    expect(linesByPerson(cart)).toEqual([
      { personId: ME, name: null, lines: ['شوربة عدس ×2'] },
      { personId: 'pp_1', name: 'سارة', lines: ['لفة تكة · بدون بصل'] },
    ]);
  });
});

describe('acceptedEta: a clock time, not a duration', () => {
  const now = new Date('2026-10-06T16:00:00Z');
  it('ready time + ride + hand-over, rounded up to 5 minutes', () => {
    expect(acceptedEta({ now, promisedReadyAt: new Date('2026-10-06T16:20:00Z'), rideMin: 8 }).toISOString()).toBe('2026-10-06T16:35:00.000Z');
  });
  it('a ready time in the past counts from now; unknown ride is 10 minutes', () => {
    expect(acceptedEta({ now, promisedReadyAt: new Date('2026-10-06T15:00:00Z'), rideMin: null }).toISOString()).toBe('2026-10-06T16:15:00.000Z');
  });
});
