import { describe, expect, it } from 'vitest';
import { AZIZIYAH_MONEY_RULES, DriverError, PostRequestInput, type Actor } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { NotifyService, RecordingTransport } from '../notify/index.js';
import { DevBlobStore } from '../places/index.js';
import { TripChatSubjects } from '../routes/index.js';
import { INTERCITY_NETWORK } from '../routes/intercity.config.js';
import { BAB1, routesHarness, type RoutesHarness } from '../routes/test-harness.js';
import { registerChatNotifications } from './chat.notify.js';
import { InMemoryChatRepository } from './chat.repository.js';
import { registerTripCards, TRIP_CARD_EVENTS } from './trip-chat.cards.js';
import { TRIP_CHAT_OPENS_PER_DAY, TripChatService } from './trip-chat.service.js';

const as = (personId: string): Actor => ({ personId, sessionId: `s-${personId}` });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};
let n = 0;
const cid = () => `client-${++n}`;

/** On the Baghdad road between the المدائن junction and the Diyala bridge. */
const ON_ROAD = { lat: 33.1667, lng: 44.5517 };
const NAMES: Record<string, string> = { r1: 'علي', r2: 'زينب', d1: 'حيدر', d2: 'كرار' };

/** The routes module and the chat on one clock; routes events reach the chat's outbox like the real bus. */
function setup() {
  const h = routesHarness();
  const ev = createInMemoryEvents({ clock: h.clock, uow: h.uow, contradictions: false });
  const transport = new RecordingTransport();
  registerChatNotifications(ev.events, new NotifyService(transport));
  const vaultReads: Array<{ personId: string; accessorId: string; purpose: string }> = [];
  const identity = {
    hasRole: async () => false,
    firstNamesFor: async (ids: readonly string[], accessorId: string, purpose: string) => {
      for (const id of ids) if (id !== accessorId) vaultReads.push({ personId: id, accessorId, purpose });
      return Object.fromEntries(ids.map((id) => [id, NAMES[id] ?? null]));
    },
    orgRoleHolders: async () => [],
  };
  const subjects = new TripChatSubjects(h.repo, h.clock, INTERCITY_NETWORK, h.requests);
  const repo = new InMemoryChatRepository();
  const chat = new TripChatService(repo, subjects, identity, new DevBlobStore(h.clock, { secret: 'test' }), ev.events, h.uow, h.clock);
  registerTripCards(ev.events, subjects, chat);
  let forwarded = 0;
  /** Hands the new routes events to the outbox and runs the subscribers (cards, then their pushes). */
  async function deliver() {
    for (const e of h.events.events.slice(forwarded)) {
      if ((TRIP_CARD_EVENTS as readonly string[]).includes(e.type)) await ev.events.emit(undefined, e, e.aggregate);
    }
    forwarded = h.events.events.length;
    await ev.publisher.drainUntilIdle();
  }
  return { h, ev, chat, repo, transport, vaultReads, deliver };
}

function postRequest(h: RoutesHarness, riderId = 'r1') {
  return h.requests.post(
    riderId,
    PostRequestInput.parse({ from: { label: 'كراج البوابة 1', garageId: BAB1.id }, to: { label: 'الصويرة' }, when: h.at(120), seats: 3, privateCar: true, travellingAs: 'aila' }),
  );
}

describe('Baghdad/Kut chat on a seat run (step 4c)', () => {
  it('a rider may ask before booking; the driver answers him; each message pushes the other app', async () => {
    const { h, chat, transport, deliver } = setup();
    const dep = await h.announce();
    // The driver cannot open a thread with someone who never booked, asked or wrote.
    expect(await code(chat.thread(as('d1'), { subject: 'departure', id: dep.id, with: 'r1' }))).toBe('chat_not_party');
    expect(await code(chat.thread(as('d1'), { subject: 'departure', id: dep.id }))).toBe('chat_not_party');

    const before = await chat.thread(as('r1'), { subject: 'departure', id: dep.id });
    expect(before).toMatchObject({ threadId: null, status: 'open', myRole: 'customer', ride: true, canCall: false, partyId: 'r1', deal: [], trip: { booked: false, toCityId: dep.toCityId } });
    expect(before.quickReplies).toEqual(['rider_trip_where', 'rider_trip_bags', 'rider_trip_coming']);

    await chat.send(as('r1'), { subject: 'departure', id: dep.id, clientId: cid(), text: 'عندي جنطتين، تتسع؟ 07701234567' });
    await deliver();
    const forDriver = await chat.thread(as('d1'), { subject: 'departure', id: dep.id, with: 'r1' });
    expect(forDriver.myRole).toBe('courier');
    expect(forDriver.messages).toHaveLength(1);
    expect(forDriver.messages[0]).toMatchObject({ kind: 'text', masked: true, mine: false });
    expect(forDriver.unread).toBe(1);
    expect(transport.sent.at(-1)).toMatchObject({ to: 'd1', data: { deepLink: `driver-partner://intercity/chat/departure/${dep.id}?with=r1` } });

    await chat.send(as('d1'), { subject: 'departure', id: dep.id, with: 'r1', clientId: cid(), quickReplyKey: 'driver_trip_bags_ok' });
    await deliver();
    expect(transport.sent.at(-1)).toMatchObject({ to: 'r1', data: { deepLink: `driver://rajaa/chat/departure/${dep.id}` } });
    // A rider quick reply is refused on the driver's side.
    expect(await code(chat.send(as('d1'), { subject: 'departure', id: dep.id, with: 'r1', clientId: cid(), quickReplyKey: 'rider_trip_where' }))).toBe('chat_quick_reply_invalid');

    // The driver's list names who wrote; the rider's thread is keyed by him alone.
    const list = await chat.threads(as('d1'), { subject: 'departure', id: dep.id });
    expect(list).toEqual([expect.objectContaining({ withId: 'r1', withName: 'علي', status: 'open', unread: 0 })]);
    // Another rider sees only his own (empty) thread.
    expect((await chat.thread(as('r2'), { subject: 'departure', id: dep.id })).messages).toEqual([]);
    expect(await code(chat.thread(as('r2'), { subject: 'departure', id: dep.id, with: 'r1' }))).toBe('chat_not_party');
  });

  it('once the car leaves, a rider without a seat who never wrote cannot start; the riders in it talk until 30 min after arrival', async () => {
    const { h, chat } = setup();
    const dep = await h.announce({ departAt: h.at(5), latestDepartureAt: h.at(10) });
    const b = await h.book('r1', dep.id, ['front', 'back_left', 'back_middle', 'back_right']);
    await chat.send(as('r2'), { subject: 'departure', id: dep.id, clientId: cid(), text: 'بعد بيها مكان؟' });
    await h.driverAt(dep.id);
    await h.checkIn(dep.id, b.id);
    await h.departures.depart('d1', dep.id);

    expect(await code(chat.thread(as('r3'), { subject: 'departure', id: dep.id }))).toBe('chat_not_party');
    // r2 wrote before: he keeps reading, but his thread closes 30 min after the car left.
    const r2 = await chat.thread(as('r2'), { subject: 'departure', id: dep.id });
    expect(r2.status).toBe('open');
    expect(r2.closesAt?.getTime()).toBe(h.clock.now().getTime() + 30 * 60_000);
    expect((await chat.thread(as('r1'), { subject: 'departure', id: dep.id })).trip.booked).toBe(true);
    expect((await chat.thread(as('r1'), { subject: 'departure', id: dep.id })).closesAt).toBeNull();

    h.advance(31);
    expect((await chat.thread(as('r2'), { subject: 'departure', id: dep.id })).status).toBe('closed');
    expect(await code(chat.send(as('r2'), { subject: 'departure', id: dep.id, clientId: cid(), text: 'x' }))).toBe('chat_closed');
    await h.departures.arrive('d1', dep.id);
    await chat.send(as('r1'), { subject: 'departure', id: dep.id, clientId: cid(), text: 'شكراً' });
    h.advance(31);
    expect((await chat.thread(as('r1'), { subject: 'departure', id: dep.id })).status).toBe('closed');
    expect(await code(chat.send(as('d1'), { subject: 'departure', id: dep.id, with: 'r1', clientId: cid(), text: 'x' }))).toBe('chat_closed');
  });

  it("an ask and the driver's price come in as cards with their live state, once each, with the pinned strip", async () => {
    const { h, chat, transport, deliver } = setup();
    const dep = await h.announce();
    const pin = await h.agreements.ask('r1', { departureId: dep.id, kind: 'pin_pickup', ...ON_ROAD, note: 'جنب السيطرة' });
    await deliver();
    // The ask opened the thread for the driver, and paged him.
    expect(transport.sent.at(-1)).toMatchObject({ to: 'd1', data: { deepLink: `driver-partner://intercity/chat/departure/${dep.id}?with=r1` } });
    let d = await chat.thread(as('d1'), { subject: 'departure', id: dep.id, with: 'r1' });
    expect(d.messages.map((m) => m.card)).toEqual([expect.objectContaining({ kind: 'pin_pickup', refId: pin.id, stage: 'ask', state: 'asked', amountIqd: null, note: 'جنب السيطرة' })]);
    expect(d.messages[0]!.card!.distanceKm).toBeGreaterThan(0);
    expect(d.deal).toEqual([{ kind: 'pin_pickup', refId: pin.id, state: 'asked', amountIqd: null, locked: false }]);
    expect((await chat.threads(as('d1'), { subject: 'departure', id: dep.id }))[0]!.waitingOnYou).toBe(1);

    await h.agreements.propose('d1', { agreementId: pin.id, amountIqd: 2_000 });
    await deliver();
    await deliver(); // a redelivery writes nothing new
    let r = await chat.thread(as('r1'), { subject: 'departure', id: dep.id });
    expect(r.messages.map((m) => [m.senderRole, m.card?.stage, m.card?.state, m.card?.amountIqd])).toEqual([
      ['customer', 'ask', 'proposed', null],
      ['courier', 'price', 'proposed', 2_000],
    ]);
    expect(r.messages[1]!.card!.expiresAt).not.toBeNull();
    expect(r.deal).toEqual([{ kind: 'pin_pickup', refId: pin.id, state: 'proposed', amountIqd: 2_000, locked: false }]);
    expect((await chat.threads(as('r1'), { subject: 'departure', id: dep.id }))[0]!.waitingOnYou).toBe(1);
    expect(transport.sent.at(-1)).toMatchObject({ to: 'r1', body_ar: expect.any(String) });

    await h.agreements.respond('r1', { agreementId: pin.id, accept: true });
    r = await chat.thread(as('r1'), { subject: 'departure', id: dep.id });
    expect(r.messages.map((m) => m.card?.state)).toEqual(['accepted', 'accepted']);
    expect(r.deal[0]).toMatchObject({ state: 'agreed', amountIqd: 2_000, locked: false });

    await h.book('r1', dep.id, ['front'], { pickup: { kind: 'pin', agreementId: pin.id } });
    d = await chat.thread(as('d1'), { subject: 'departure', id: dep.id, with: 'r1' });
    expect(d.messages.map((m) => m.card?.state)).toEqual(['used', 'used']);
    expect(d.deal[0]).toMatchObject({ state: 'agreed', locked: true });
    expect(d.trip.booked).toBe(true);
  });

  it('an older card about the same price reads replaced', async () => {
    const { h, chat } = setup();
    const dep = await h.announce();
    const door = await h.agreements.ask('r1', { departureId: dep.id, kind: 'door_drop', lat: 33.3, lng: 44.4 });
    await h.agreements.propose('d1', { agreementId: door.id, amountIqd: 0 });
    const target = { subject: 'departure' as const, id: dep.id, partyId: 'r1', riderId: 'r1', driverId: 'd1' };
    await chat.writeCard(target, { kind: 'door_drop', refId: door.id, amountIqd: 3_000, actorId: 'd1', eventId: 'ev_old', at: h.at(0) });
    await chat.writeCard(target, { kind: 'door_drop', refId: door.id, amountIqd: 0, actorId: 'd1', eventId: 'ev_new', at: h.at(0) });
    await chat.writeCard(target, { kind: 'door_drop', refId: door.id, amountIqd: 0, actorId: 'd1', eventId: 'ev_new', at: h.at(0) });
    const r = await chat.thread(as('r1'), { subject: 'departure', id: dep.id });
    expect(r.messages.map((m) => [m.card?.amountIqd, m.card?.state])).toEqual([
      [3_000, 'replaced'],
      [0, 'proposed'],
    ]);
    expect(r.messages[0]!.card!.expiresAt).toBeNull();
  });
});

describe('Baghdad/Kut chat on a private-car request (step 4c)', () => {
  it('the rider talks to each driver who offered; after the pick, only the picked one', async () => {
    const { h, chat, transport, deliver, vaultReads } = setup();
    const r = await postRequest(h);
    const o1 = (await h.requests.offer('d1', r.id, 28_000)).offers.at(-1)!;
    await h.requests.offer('d2', r.id, 40_000);
    expect(await code(chat.thread(as('d3'), { subject: 'request', id: r.id }))).toBe('chat_not_party');
    expect(await code(chat.thread(as('r1'), { subject: 'request', id: r.id }))).toBe('chat_not_party');
    expect(await code(chat.thread(as('r1'), { subject: 'request', id: r.id, with: 'd3' }))).toBe('chat_not_party');

    await chat.send(as('r1'), { subject: 'request', id: r.id, with: 'd1', clientId: cid(), text: 'السيارة بيها تبريد؟' });
    await chat.send(as('r1'), { subject: 'request', id: r.id, with: 'd2', clientId: cid(), text: 'السيارة بيها تبريد؟' });
    await deliver();
    expect(transport.sent.at(-1)).toMatchObject({ to: 'd2', data: { deepLink: `driver-partner://intercity/chat/request/${r.id}` } });
    await chat.send(as('d1'), { subject: 'request', id: r.id, clientId: cid(), text: 'إي، كيا جديدة' });
    await deliver();
    expect(transport.sent.at(-1)).toMatchObject({ to: 'r1', data: { deepLink: `driver://rajaa/chat/request/${r.id}?with=d1` } });
    // d2 only sees his own thread.
    expect((await chat.thread(as('d2'), { subject: 'request', id: r.id })).messages).toHaveLength(1);
    const list = await chat.threads(as('r1'), { subject: 'request', id: r.id });
    expect(list.map((t) => [t.withId, t.withName, t.unread])).toEqual([
      ['d1', 'حيدر', 1],
      ['d2', 'كرار', 0],
    ]);
    expect(vaultReads.every((v) => v.purpose === 'trip_chat')).toBe(true);

    h.wallet.set('r1', 20_000);
    await h.requests.pick('r1', r.id, o1.id);
    expect((await chat.thread(as('d1'), { subject: 'request', id: r.id })).status).toBe('open');
    expect((await chat.thread(as('d1'), { subject: 'request', id: r.id })).trip).toMatchObject({ booked: true, toLabel: 'الصويرة' });
    expect((await chat.thread(as('r1'), { subject: 'request', id: r.id, with: 'd2' })).status).toBe('closed');
    expect(await code(chat.send(as('d2'), { subject: 'request', id: r.id, clientId: cid(), text: 'x' }))).toBe('chat_closed');
  });

  it('«احجز وادفع كاش» shows as a card for that driver, follows his answer and the pick', async () => {
    const { h, chat, deliver } = setup();
    h.requests.moneyRules = { ...AZIZIYAH_MONEY_RULES, requestCashReservation: { enabled: true } };
    const r = await postRequest(h);
    const o = (await h.requests.offer('d1', r.id, 28_000)).offers.at(-1)!;
    await h.requests.askCash('r1', r.id, o.id);
    await deliver();
    let d = await chat.thread(as('d1'), { subject: 'request', id: r.id });
    expect(d.messages.map((m) => m.card)).toEqual([expect.objectContaining({ kind: 'cash_reservation', refId: o.id, stage: 'ask', state: 'asked', amountIqd: 6_000 })]);
    expect(d.deal).toEqual([{ kind: 'cash_reservation', refId: o.id, state: 'asked', amountIqd: 6_000, locked: false }]);

    await h.requests.answerCash('d1', r.id, o.id, true);
    expect((await chat.thread(as('r1'), { subject: 'request', id: r.id, with: 'd1' })).messages[0]!.card!.state).toBe('accepted');
    await h.requests.pick('r1', r.id, o.id, true);
    d = await chat.thread(as('d1'), { subject: 'request', id: r.id });
    expect(d.messages[0]!.card!.state).toBe('used');
    expect(d.deal[0]).toMatchObject({ state: 'agreed', locked: true });
  });

  it(`one person starts at most ${TRIP_CHAT_OPENS_PER_DAY} new threads a day; writing in an existing one is not counted`, async () => {
    const { h, chat } = setup();
    const deps = [];
    for (let i = 0; i <= TRIP_CHAT_OPENS_PER_DAY; i += 1) deps.push(await h.announce({ driverId: `dx${i}` }));
    for (let i = 0; i < TRIP_CHAT_OPENS_PER_DAY; i += 1) {
      await chat.send(as('r1'), { subject: 'departure', id: deps[i]!.id, clientId: cid(), text: 'هلا' });
      h.advance(1); // under the per-minute send budget
    }
    expect(await code(chat.send(as('r1'), { subject: 'departure', id: deps[TRIP_CHAT_OPENS_PER_DAY]!.id, clientId: cid(), text: 'هلا' }))).toBe('rate_limited');
    expect(await code(chat.send(as('r1'), { subject: 'departure', id: deps[0]!.id, clientId: cid(), text: 'ثانية' }))).toBe('ok');
  });
});
