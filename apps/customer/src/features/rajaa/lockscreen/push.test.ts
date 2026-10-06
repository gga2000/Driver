import { describe, expect, it } from 'vitest';
import { decodeRajaaPassPush, encodeRajaaPassPush, RAJAA_PASS_PUSH_KIND, type RajaaPassPush } from '@driver/contracts';
import { createT } from '@driver/i18n';
import { passCard, passCardFromPush, type PassCard } from './content';
import type { OngoingLabels } from './ongoing';
import { applyPassPush } from './push';

const t = createT('ar-IQ');
const strip = (s: string | null) => (s ?? '').replace(/[⁦⁩]/g, '');
const amount = (n: number) => n.toLocaleString('en-US');
// 2026-10-05 16:00Z = 7:00 م in Aziziyah; the car leaves at 7:30 م.
const NOW = new Date('2026-10-05T16:00:00Z');
const DEPART = new Date('2026-10-05T16:30:00Z');

function push(over: Partial<RajaaPassPush> = {}): RajaaPassPush {
  return {
    kind: RAJAA_PASS_PUSH_KIND,
    bookingId: 'bk1',
    phase: 'boarding',
    departAt: DEPART,
    stop: 'كراج النهضة',
    pickupKind: 'garage',
    toCity: 'العزيزية',
    seatIds: ['back_middle'],
    pin: '5481',
    carKm: 1.04,
    fareIqd: 10_000,
    sentAt: NOW,
    ...over,
  };
}

describe('the lock-screen card from a server push (customer d-8 follow-up)', () => {
  it('boarding: the garage, seat and PIN, the car\'s distance (or the countdown) and «أني بالكراج»', () => {
    const c = passCardFromPush(push(), t, amount, NOW)!;
    expect(c).toMatchObject({ id: 'rajaa-pass-bk1', phase: 'boarding', sticky: true, imHere: 'garage', deepLink: 'driver://rajaa/pass/bk1' });
    expect(c.title).toContain('كراج النهضة');
    expect(c.body).toContain('5481');
    expect(strip(c.sub)).toContain('1.0');
    expect(strip(passCardFromPush(push({ carKm: null }), t, amount, NOW)!.sub)).toContain('30');
    expect(passCardFromPush(push({ pickupKind: 'meeting_point', stop: 'جسر ديالى' }), t, amount, NOW)).toMatchObject({ imHere: 'point' });
    expect(passCardFromPush(push({ pickupKind: 'door' }), t, amount, NOW)).toMatchObject({ imHere: null });
  });

  it('on board, on the road, arrived with the fare; gone removes it', () => {
    expect(passCardFromPush(push({ phase: 'on_board' }), t, amount, NOW)).toMatchObject({ phase: 'on_board', sticky: true, imHere: null, sub: null });
    const road = passCardFromPush(push({ phase: 'on_road' }), t, amount, NOW)!;
    expect(road.title).toContain('العزيزية');
    const done = passCardFromPush(push({ phase: 'arrived', fareIqd: 12_500 }), t, amount, NOW)!;
    expect(done).toMatchObject({ phase: 'arrived', sticky: false });
    expect(strip(done.body)).toContain('12,500');
    expect(passCardFromPush(push({ phase: 'gone' }), t, amount, NOW)).toBeNull();
  });

  it('says what the in-app card says for the same moment (on the road)', () => {
    const fromApp = passCard(
      {
        booking: { id: 'bk1', state: 'checked_in', seatIds: ['back_middle'], pin: '5481', pickup: { kind: 'garage' }, totalIqd: 10_000, departure: { departAt: DEPART, state: 'departed' } } as never,
        pass: null,
        stopName: 'كراج النهضة',
        toCity: 'العزيزية',
        amount,
        now: NOW,
      },
      t,
    )!;
    const fromPush = passCardFromPush(push({ phase: 'on_road' }), t, amount, NOW)!;
    expect([fromPush.title, fromPush.body, fromPush.sticky]).toEqual([fromApp.title, fromApp.body, fromApp.sticky]);
  });

  it('survives the trip through push data', () => {
    const back = decodeRajaaPassPush(encodeRajaaPassPush(push()))!;
    expect(passCardFromPush(back, t, amount, NOW)!.title).toBe(passCardFromPush(push(), t, amount, NOW)!.title);
  });
});

describe('applyPassPush', () => {
  const labels: OngoingLabels = { channel: 'ch', channelDesc: 'd', imHereGarage: 'g', imHerePoint: 'p' };
  function device() {
    const shown: PassCard[] = [];
    const dismissed: string[] = [];
    return { shown, dismissed, show: async (c: PassCard) => void shown.push(c), dismiss: async (id: string) => void dismissed.push(id) };
  }

  it('re-posts the card, removes it when gone, and drops a push older than the last one applied', async () => {
    const d = device();
    const lastSentAt = new Map<string, number>();
    const ctx = { t, amount, labels, device: d, now: NOW, lastSentAt };
    expect(await applyPassPush(push({ phase: 'on_road', sentAt: new Date(NOW.getTime() + 60_000) }), ctx)).toContain('on_road');
    expect(await applyPassPush(push({ phase: 'boarding', sentAt: NOW }), ctx)).toBeNull();
    expect(d.shown.map((c) => c.phase)).toEqual(['on_road']);
    expect(await applyPassPush(push({ phase: 'gone', sentAt: new Date(NOW.getTime() + 120_000) }), ctx)).toBe('');
    expect(d.dismissed).toEqual(['rajaa-pass-bk1']);
  });
});
