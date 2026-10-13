import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SendParcelInput, type Order } from '@driver/contracts';
import { notifyHarness, ScriptedPush } from '../notify/test-harness.js';
import type { OrdersRidersPort } from '../orders/index.js';
import { InMemoryParcelsRepository } from './parcels.repository.js';
import { ParcelsService } from './parcels.service.js';
import type { ParcelsOrdersPort, ParcelsPeoplePort, ParcelsPlacesPort } from './ports.js';

/** 12:00 Baghdad. */
const NOON = '2026-10-12T09:00:00Z';
/** 23:30 Baghdad. */
const NIGHT = '2026-10-12T20:30:00Z';
const BASE = 'https://driver.iq';
const MIN = 60_000;
const HOUR = 60 * MIN;

/** Receivers by their typed number (local form) → person id and the E.164 the vault holds. */
const phoneOf = (i: number) => `0780123${String(4000 + i)}`;
const e164Of = (i: number) => `+964780123${String(4000 + i)}`;
const personOf = (phone: string) => `rcv_${phone.slice(-4)}`;

function setup(opts: { start?: string; spent?: boolean } = {}) {
  const phones: Record<string, string> = {};
  for (let i = 0; i < 20; i++) phones[personOf(phoneOf(i))] = e164Of(i);
  const push = new ScriptedPush(false);
  const n = notifyHarness({ start: opts.start ?? NOON, phones, push });
  const repo = new InMemoryParcelsRepository();
  let seq = 0;
  const orders: ParcelsOrdersPort = {
    fare: async () => 3000,
    place: async () => ({ id: `ord_${++seq}`, state: 'placed' }) as unknown as Order,
    order: async () => null,
    cancel: async () => ({}) as Order,
    courierOf: async () => null,
    lastFix: async () => null,
    proofs: async () => ({ pickup: null, dropoff: null }),
  };
  const vaultReads: string[] = [];
  const people: ParcelsPeoplePort = {
    firstName: async (personId, accessorId, purpose) => {
      vaultReads.push(`${personId}:${accessorId}:${purpose}`);
      return personId === 'snd_long' ? 'عبدالرحمنعبدالرحمنعبدالرحمن الطويل' : 'علي محمد';
    },
    phoneMasked: async () => '0780 *** 4000',
  };
  const places: ParcelsPlacesPort = {
    zoneOf: () => 'hay_1',
    zone: () => ({ name: 'حي العسكري', centre: { lat: 32.91, lng: 45.06 } }),
    photoOwned: async () => true,
    photoUrl: (id) => `https://files.example/${id}`,
  };
  const riders: OrdersRidersPort = {
    resolve: async (_booker, input) => {
      if (input.from === 'typed') return { personId: personOf(input.phone), phoneHash: `h_${input.phone}`, name: input.name };
      if (input.from === 'household') return { personId: input.personId, phoneHash: null, name: 'ماما' };
      return { personId: personOf(phoneOf(19)), phoneHash: null, name: 'خالي' };
    },
    remember: async () => undefined,
    names: async () => ({}),
  };
  const budget = { spent: async () => opts.spent ?? false };
  const make = () => new ParcelsService(repo, orders, people, places, riders, BASE, n.clock, n.service, budget);
  let svc = make();
  const send = (sender: string, recipient: SendParcelInput['recipient'], door: SendParcelInput['door'] = { by: 'receiver', zoneKey: 'hay_1' }) =>
    svc.send(
      { personId: sender, sessionId: `s-${sender}` },
      SendParcelInput.parse({ clientRequestId: `req_${Math.random().toString(36).slice(2, 12)}`, what: 'ملابس العيد', declaredValueIqd: 10_000, recipient, pickup: { zoneKey: 'hay_1' }, door, fareIqd: 3000 }),
    );
  const typed = (i: number) => ({ from: 'typed' as const, name: 'حسن', phone: phoneOf(i) });
  const texts = async (template: string) => (await n.repo.log({ limit: 500 })).filter((r) => r.template === template && r.channel === 'sms' && r.status === 'sent');
  /** A restart: a new service over the same table (nothing in memory carries over). */
  const restart = () => {
    svc = make();
  };
  return { n, push, repo, svc: () => svc, send, typed, texts, restart, vaultReads };
}

const tokenOf = (body: string) => /\/p\/([A-Za-z0-9_-]+)/.exec(body)?.[1] ?? null;

describe('parcel texts: the door link and the receipt code', () => {
  it('daytime: one door-link text at once, our link with its own token, the first name only, never the parcel words', async () => {
    const h = setup();
    const view = await h.send('snd_long', h.typed(0));
    await h.n.run();
    expect(h.n.sms.sent).toHaveLength(1);
    const sms = h.n.sms.sent[0]!;
    expect(sms.to).toBe(e164Of(0));
    expect(sms.body).toContain(`${BASE}/p/`);
    expect(sms.body).not.toContain('ملابس العيد');
    expect(sms.body).not.toContain('الطويل');
    const long = 'عبدالرحمنعبدالرحمنعبدالرحمن';
    expect(sms.body).toContain(long.slice(0, 20));
    expect(sms.body).not.toContain(long.slice(0, 21));
    expect(view.doorLinkTexted).toBe(true);
    expect(view.textCapped).toBe(false);
    // The text's link and the sender's own both open the door page; they are different tokens.
    const texted = tokenOf(sms.body)!;
    const shared = tokenOf(view.doorLink!)!;
    expect(texted).not.toBe(shared);
    expect(texted.length).toBeGreaterThanOrEqual(22); // ≥ 128 random bits
    await expect(h.svc().doorPage({ token: texted })).resolves.toMatchObject({ open: true });
    await expect(h.svc().doorPage({ token: shared })).resolves.toMatchObject({ open: true });
    // The sender's name was read from the vault for the text.
    expect(h.vaultReads).toContain('snd_long:system:parcels:parcel_text');
  });

  it('dedup: one door text and one code text per parcel, whatever is retried', async () => {
    const h = setup();
    const view = await h.send('snd_a', h.typed(1));
    await h.n.run();
    for (let i = 0; i < 3; i++) {
      await h.svc().sweep();
      await h.n.run(MIN);
    }
    expect(await h.texts('parcel_door_link')).toHaveLength(1);
    // A repeat of the same notify request (same event key) inserts nothing.
    expect(await h.n.service.dispatch({ eventId: `parcel:${view.id}:door`, template: 'parcel_door_link', to: personOf(phoneOf(1)), params: { sender: 'علي', link: `${BASE}/p/x` } })).toEqual([]);

    const token = tokenOf(h.n.sms.sent[0]!.body)!;
    await h.svc().setDoor({ token, pin: { lat: 32.91, lng: 45.06 } });
    await h.n.run();
    for (let i = 0; i < 3; i++) {
      await h.svc().sweep();
      await h.n.run(MIN);
    }
    const pins = await h.texts('parcel_pin');
    expect(pins).toHaveLength(1);
    const pin = (await h.svc().get({ personId: 'snd_a', sessionId: 's' }, { parcelId: view.id })).pin!;
    expect(h.n.sms.sent.at(-1)!.body).toContain(pin);
    expect(await h.n.service.dispatch({ eventId: `parcel:${view.id}:pin`, template: 'parcel_pin', to: personOf(phoneOf(1)), params: { sender: 'علي', pin } })).toEqual([]);
    expect(h.n.sms.sent).toHaveLength(2);
  });

  it('quiet hours: a door link made at 23:30 is texted at 08:00 by the sweep, even after a restart', async () => {
    const h = setup({ start: NIGHT });
    const view = await h.send('snd_a', h.typed(2));
    await h.n.run();
    expect(h.n.sms.sent).toHaveLength(0);
    expect(view.doorLinkTexted).toBe(false);
    expect(view.doorTextAt?.toISOString()).toBe('2026-10-13T05:00:00.000Z'); // 08:00 Baghdad
    await h.svc().sweep();
    h.n.clock.set('2026-10-13T04:59:00Z');
    await h.svc().sweep();
    await h.n.run();
    expect(h.n.sms.sent).toHaveLength(0);
    h.restart();
    h.n.clock.set('2026-10-13T05:00:00Z');
    await h.svc().sweep();
    await h.n.run();
    expect(h.n.sms.sent).toHaveLength(1);
    const [row] = await h.texts('parcel_door_link');
    expect(row!.sentAt?.toISOString()).toBe('2026-10-13T05:00:00.000Z');
    // The morning text's link opens the parcel (its own token, made when the text went).
    await expect(h.svc().doorPage({ token: tokenOf(h.n.sms.sent[0]!.body)! })).resolves.toMatchObject({ open: true });
  });

  it('the receipt code goes any hour: a door the sender set at 23:30 texts the code at once', async () => {
    const h = setup({ start: NIGHT });
    const view = await h.send('snd_a', h.typed(3), { by: 'sender', dropoff: { zoneKey: 'hay_1', pin: { lat: 32.91, lng: 45.06 } } });
    await h.n.run();
    expect(h.n.sms.sent).toHaveLength(1);
    expect(h.n.sms.sent[0]!.body).toContain(view.pin!);
    expect(view.pinTexted).toBe(true);
    expect(await h.texts('parcel_door_link')).toHaveLength(0);
  });

  it('sender cap: 5 parcels a day to strangers get texts, the 6th none (the parcel still works); known people are outside it', async () => {
    const h = setup();
    for (let i = 0; i < 5; i++) await h.send('snd_a', h.typed(i));
    const sixth = await h.send('snd_a', h.typed(5));
    await h.n.run();
    expect(await h.texts('parcel_door_link')).toHaveLength(5);
    expect(sixth.textCapped).toBe(true);
    expect(sixth.doorLinkTexted).toBe(false);
    expect(sixth.state).toBe('waiting_door');
    expect(sixth.doorLink).toMatch(`${BASE}/p/`);
    // The sweep does not text a capped parcel later either.
    await h.svc().sweep();
    await h.n.run();
    expect(await h.texts('parcel_door_link')).toHaveLength(5);
    // A household member is not a stranger: still texted.
    const family = await h.send('snd_a', { from: 'household', householdId: 'hh_1', personId: personOf(phoneOf(9)) });
    await h.n.run();
    expect(family.doorLinkTexted).toBe(true);
    expect(await h.texts('parcel_door_link')).toHaveLength(6);
    // The next Baghdad day the count starts again.
    h.n.clock.set('2026-10-13T06:00:00Z'); // 09:00 on the 13th
    const next = await h.send('snd_a', h.typed(6));
    expect(next.doorLinkTexted).toBe(true);
  });

  it('receiver cap: at most 3 parcel texts a day to one number from everyone', async () => {
    const h = setup();
    for (const s of ['snd_1', 'snd_2', 'snd_3']) expect((await h.send(s, h.typed(7))).doorLinkTexted).toBe(true);
    const fourth = await h.send('snd_4', h.typed(7));
    await h.n.run();
    expect(fourth.textCapped).toBe(true);
    expect(h.n.sms.sent.filter((m) => m.to === e164Of(7))).toHaveLength(3);
    // A capped parcel gets no code text either once its door is set; the sender sees the code himself.
    await h.svc().setDoor({ token: tokenOf(fourth.doorLink!)!, pin: { lat: 32.91, lng: 45.06 } });
    await h.n.run();
    expect(h.n.sms.sent.filter((m) => m.to === e164Of(7))).toHaveLength(3);
    expect((await h.svc().get({ personId: 'snd_4', sessionId: 's' }, { parcelId: fourth.id })).pin).toMatch(/^\d{4}$/);
  });

  it("past the day's shared SMS budget: no parcel text, marked capped", async () => {
    const h = setup({ spent: true });
    const view = await h.send('snd_a', h.typed(8));
    await h.n.run();
    expect(h.n.sms.sent).toHaveLength(0);
    expect(view.textCapped).toBe(true);
  });

  it('a door never set in time: the parcel is cancelled and the sender hears it once, in his app', async () => {
    const h = setup();
    await h.n.register('snd_a');
    const view = await h.send('snd_a', h.typed(10));
    await h.n.run();
    h.n.clock.advance(2 * HOUR + MIN);
    expect(await h.svc().sweep()).toBe(1);
    expect(await h.svc().sweep()).toBe(0);
    await h.n.run();
    const rows = (await h.n.rows({ personId: 'snd_a' })).filter((r) => r.template === 'parcel_door_lapsed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: 'push', status: 'sent' });
    expect(h.push.sent.at(-1)?.data?.['deepLink']).toBe(`driver://parcel/${view.id}`);
    expect((await h.svc().get({ personId: 'snd_a', sessionId: 's' }, { parcelId: view.id })).state).toBe('cancelled');
  });

  describe('the number never leaves the vault', () => {
    let written: string[] = [];
    beforeEach(() => {
      written = [];
      const keep = (...args: unknown[]) => {
        written.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        return true;
      };
      vi.spyOn(process.stdout, 'write').mockImplementation(keep as never);
      vi.spyOn(process.stderr, 'write').mockImplementation(keep as never);
      for (const m of ['log', 'warn', 'error', 'info', 'debug'] as const) vi.spyOn(console, m).mockImplementation(keep as never);
    });
    afterEach(() => vi.restoreAllMocks());

    it('not in notify params, payloads or the delivery log, nor in any log line; read from the vault at send time', async () => {
      const h = setup({ start: NIGHT });
      const view = await h.send('snd_a', h.typed(11));
      h.n.clock.set('2026-10-13T05:00:00Z');
      await h.svc().sweep();
      await h.n.run();
      await h.svc().setDoor({ token: tokenOf(h.n.sms.sent[0]!.body)!, pin: { lat: 32.91, lng: 45.06 } });
      await h.n.run();
      expect(h.n.sms.sent).toHaveLength(2);
      const rows = await h.n.repo.log({ limit: 500 });
      const dump = JSON.stringify(rows) + JSON.stringify(h.repo.rows) + written.join('\n');
      for (const needle of [e164Of(11), phoneOf(11), e164Of(11).slice(4), e164Of(11).slice(1)]) expect(dump).not.toContain(needle);
      // Notify asked the vault for the number when each text went.
      expect(h.n.phoneReads).toEqual([`${personOf(phoneOf(11))}:notify:parcel_door_link`, `${personOf(phoneOf(11))}:notify:parcel_pin`]);
      expect(rows.every((r) => r.personId !== view.id)).toBe(true);
    });
  });
});
