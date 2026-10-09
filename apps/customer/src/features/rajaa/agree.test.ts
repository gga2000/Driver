import { describe, expect, it } from 'vitest';
import type { AgreementView } from '@driver/contracts';
import { agreementPhase, stopNameOf } from './agree';

const at = (min: number) => new Date(Date.UTC(2026, 9, 8, 12, min));
function ag(over: Partial<AgreementView>): AgreementView {
  return {
    id: 'ag_1',
    departureId: 'dep_1',
    riderId: 'r1',
    kind: 'pin_pickup',
    state: 'asked',
    lat: 33.1,
    lng: 44.5,
    note: null,
    amountIqd: null,
    askedAt: at(0),
    proposedAt: null,
    expiresAt: null,
    decidedAt: null,
    bookingId: null,
    riderFirstName: null,
    ...over,
  };
}

describe('agreementPhase', () => {
  it('nothing asked → ask; the newest of the kind decides; withdrawn ones are as if never asked', () => {
    expect(agreementPhase(undefined, 'pin_pickup')).toEqual({ phase: 'ask', last: null });
    const all = [ag({ id: 'old', state: 'declined', askedAt: at(0) }), ag({ id: 'new', state: 'asked', askedAt: at(5) }), ag({ id: 'door', kind: 'door_drop', state: 'used', amountIqd: 0, askedAt: at(9) })];
    expect(agreementPhase(all, 'pin_pickup')).toMatchObject({ phase: 'waiting', agreement: { id: 'new' } });
    expect(agreementPhase(all, 'door_drop')).toMatchObject({ phase: 'agreed', agreement: { id: 'door' } });
    expect(agreementPhase([ag({ state: 'withdrawn' })], 'pin_pickup')).toEqual({ phase: 'ask', last: null });
  });

  it('a price is answerable until it runs out; then (and after a no) the rider asks again', () => {
    const priced = ag({ state: 'proposed', amountIqd: 2_000, expiresAt: at(30) });
    expect(agreementPhase([priced], 'pin_pickup', at(29))).toMatchObject({ phase: 'priced' });
    expect(agreementPhase([priced], 'pin_pickup', at(30))).toEqual({ phase: 'ask', last: 'expired' });
    expect(agreementPhase([ag({ state: 'expired' })], 'pin_pickup')).toEqual({ phase: 'ask', last: 'expired' });
    expect(agreementPhase([ag({ state: 'declined' })], 'pin_pickup')).toEqual({ phase: 'ask', last: 'declined' });
  });
});

describe('stopNameOf', () => {
  const names = { pin: 'نقطتك على الطريق', door: 'من باب البيت', place: (s: string) => s.replace(' (مسودة)', '') };
  it('names the garage, a meeting point, an agreed spot by its landmark, or the door', () => {
    expect(stopNameOf({ kind: 'garage', nameAr: null, note: null }, 'البوابة', names)).toBe('البوابة');
    expect(stopNameOf({ kind: 'meeting_point', nameAr: 'جسر ديالى', note: null }, 'البوابة', names)).toBe('جسر ديالى');
    expect(stopNameOf({ kind: 'pin', nameAr: null, note: 'جنب السيطرة' }, 'البوابة', names)).toBe('جنب السيطرة');
    expect(stopNameOf({ kind: 'pin', nameAr: null, note: null }, 'البوابة', names)).toBe('نقطتك على الطريق');
    expect(stopNameOf({ kind: 'door', nameAr: null, note: 'الباب الأخضر' }, 'البوابة', names)).toBe('من باب البيت');
  });
});
