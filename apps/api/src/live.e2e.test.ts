import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from '@trpc/client';
import { transformer, type AppRouter, type LiveEvent } from '@driver/contracts';
import { createFetchEventSource, createStreamTokenCache } from '@driver/contracts/live-client';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { createApp } from './bootstrap.js';
import { CatalogService, seedStorefronts } from './modules/catalog/index.js';
import { IdentityService } from './modules/identity/index.js';
import { LIVE_BUS, type LiveBus } from './modules/live/index.js';
import { OrdersService } from './modules/orders/index.js';
import { OrgsService } from './modules/orgs/index.js';

const ZAKUR = { lat: 32.887, lng: 45.0765 };
const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };

/** One open subscription: the events so far, a waiter, and how it ended. */
interface Tap {
  events: LiveEvent[];
  error: unknown;
  next(pred: (e: LiveEvent) => boolean, timeoutMs?: number): Promise<LiveEvent>;
  ended(timeoutMs?: number): Promise<unknown>;
  close(): void;
}

/** `live.*` over real SSE: the stream token in connection params, events through httpSubscriptionLink. */
describe('live channel over SSE (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  const anon = () =>
    createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });

  /** The app wiring: Bearer for queries/mutations, stream token for subscriptions (EventSource can't send headers). */
  function clientFor(accessToken: string) {
    const bearer = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${origin}/trpc`,
          transformer,
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      ],
    });
    const tokens = createStreamTokenCache(() => bearer.live.token.mutate());
    const client = createTRPCClient<AppRouter>({
      links: [
        splitLink({
          condition: (op) => op.type === 'subscription',
          true: httpSubscriptionLink({
            url: `${origin}/trpc`,
            transformer,
            EventSource: createFetchEventSource(),
            connectionParams: async () => ({ streamToken: await tokens.get() }),
          }),
          false: httpBatchLink({
            url: `${origin}/trpc`,
            transformer,
            headers: { authorization: `Bearer ${accessToken}` },
          }),
        }),
      ],
    });
    return { client, tokens };
  }

  async function signIn(phone: string) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({
      phone,
      code: code!,
      device: { fingerprint: `live-${phone}`, platform: 'web' },
    });
    return {
      ...clientFor(res.tokens.accessToken),
      personId: res.personId,
      accessToken: res.tokens.accessToken,
    };
  }

  function tap(
    subscribe: (h: {
      onData(e: LiveEvent): void;
      onError(err: unknown): void;
      onComplete(): void;
    }) => { unsubscribe(): void },
  ): Tap {
    const events: LiveEvent[] = [];
    const waiters: Array<() => void> = [];
    let error: unknown = null;
    let done = false;
    const wakeAll = () => waiters.splice(0).forEach((w) => w());
    const sub = subscribe({
      onData: (e) => {
        events.push(e);
        wakeAll();
      },
      onError: (err) => {
        error = err;
        done = true;
        wakeAll();
      },
      onComplete: () => {
        done = true;
        wakeAll();
      },
    });
    const wait = () => new Promise<void>((r) => waiters.push(r));
    return {
      events,
      get error() {
        return error;
      },
      async next(pred, timeoutMs = 5000) {
        const end = Date.now() + timeoutMs;
        let seen = 0;
        for (;;) {
          const hit = events.slice(seen).find(pred);
          if (hit) return hit;
          seen = 0;
          if (done)
            throw new Error(
              `stream ended: ${String((error as Error | null)?.message ?? 'complete')}`,
            );
          if (Date.now() > end)
            throw new Error(
              `no matching event in ${timeoutMs} ms; got ${JSON.stringify(events.map((e) => e.type))}`,
            );
          await Promise.race([wait(), new Promise((r) => setTimeout(r, 100))]);
        }
      },
      async ended(timeoutMs = 5000) {
        const end = Date.now() + timeoutMs;
        while (!done && Date.now() < end)
          await Promise.race([wait(), new Promise((r) => setTimeout(r, 100))]);
        return error;
      },
      close: () => sub.unsubscribe(),
    };
  }

  const codeOf = (err: unknown) =>
    err instanceof TRPCClientError
      ? (err.data as { code?: string } | undefined)?.code
      : String(err);

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('stream tokens: minted with a Bearer token, good for live.* only, never as an access token', async () => {
    const me = await signIn('07715550001');
    const { token, expiresAt } = await me.client.live.token.mutate();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    // As a Bearer token it is nothing.
    const asBearer = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${origin}/trpc`,
          transformer,
          headers: { authorization: `Bearer ${token}` },
        }),
      ],
    });
    expect(await asBearer.identity.me.query().then(() => 'ok', codeOf)).toBe('token_invalid');
    // Unauthenticated: no token, no stream.
    expect(
      await anon()
        .live.token.mutate()
        .then(() => 'ok', codeOf),
    ).toBe('unauthorized');
  });

  it('customer order stream: hello, then the order moving (patch + invalidate); a stranger is refused', async () => {
    const [khalid] = await seedStorefronts(
      app.get(OrgsService),
      app.get(CatalogService),
      AZIZIYAH_RESTAURANTS.slice(0, 1).map((r) => ({ ...r, hours: [] })),
      'live-owner',
    );
    await app.get(OrgsService).settled();
    const customer = await signIn('07715550002');
    const placed = await app.get(OrdersService).place(customer.personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid!.orgId,
      lines: [{ catalogItemId: khalid!.itemIds.get('liver_plate')!, qty: 1 }],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: ZAKUR },
    });

    const t = tap((h) => customer.client.live.order.subscribe({ orderId: placed.id }, h));
    await t.next((e) => e.type === 'hello');
    await app
      .get(OrdersService)
      .merchantAccept('live-staff', { orderId: placed.id, prepMinutes: 15 });
    expect(await t.next((e) => e.type === 'order_state')).toMatchObject({
      type: 'order_state',
      orderId: placed.id,
      state: 'merchant_accepted',
      cause: 'order.accepted',
    });
    expect(await t.next((e) => e.type === 'invalidate')).toMatchObject({
      keys: expect.arrayContaining(['orders.track']),
      orderId: placed.id,
    });
    t.close();

    const stranger = await signIn('07715550003');
    const s = tap((h) => stranger.client.live.order.subscribe({ orderId: placed.id }, h));
    expect(codeOf(await s.ended())).toBe('forbidden');
    expect(s.events.some((e) => e.type === 'hello')).toBe(false);
  });

  it('a courier only ever hears his own channel; a customer cannot open a partner stream', async () => {
    const identity = app.get(IdentityService);
    const bus = app.get<LiveBus>(LIVE_BUS);
    const a = await signIn('07715550004');
    const b = await signIn('07715550005');
    await identity.grantRole(SYSTEM, { personId: a.personId, kind: 'courier' });
    await identity.grantRole(SYSTEM, { personId: b.personId, kind: 'courier' });

    const ta = tap((h) => a.client.live.partner.subscribe(undefined, h));
    expect(await ta.next((e) => e.type === 'hello')).toMatchObject({
      channels: [`driver:${a.personId}`],
    });
    await bus.publish(`driver:${b.personId}`, {
      type: 'invalidate',
      keys: ['partner.currentOffer'],
      cause: 'test.for_b',
    });
    await bus.publish(`driver:${a.personId}`, {
      type: 'invalidate',
      keys: ['partner.currentOffer'],
      cause: 'test.for_a',
    });
    await ta.next((e) => e.type === 'invalidate' && e.cause === 'test.for_a');
    expect(ta.events.some((e) => e.type === 'invalidate' && e.cause === 'test.for_b')).toBe(false);
    ta.close();

    const customer = await signIn('07715550006');
    expect(
      codeOf(await tap((h) => customer.client.live.partner.subscribe(undefined, h)).ended()),
    ).toBe('forbidden');
  });

  it('merchant staff hear their own store (new orders ring at once) and are refused on another', async () => {
    const [store, other] = await seedStorefronts(
      app.get(OrgsService),
      app.get(CatalogService),
      AZIZIYAH_RESTAURANTS.slice(1, 3).map((r) => ({ ...r, hours: [] })),
      'live-owner-2',
    );
    await app.get(OrgsService).settled();
    const staff = await signIn('07715550007');
    await app
      .get(IdentityService)
      .grantRole(SYSTEM, { personId: staff.personId, kind: 'merchant_staff', orgId: store!.orgId });

    const board = tap((h) =>
      staff.client.live.merchantBoard.subscribe({ merchantOrgId: store!.orgId }, h),
    );
    await board.next((e) => e.type === 'hello');
    const customer = await signIn('07715550008');
    const plain = store!.seed.categories
      .flatMap((c) => c.items)
      .find((i) => !(i.modifierGroups ?? []).some((g) => g.required || (g.min ?? 0) > 0))!;
    const itemId = store!.itemIds.get(plain.key)!;
    const qty = Math.max(1, Math.ceil(store!.seed.minOrderIqd / plain.priceIqd));
    const placed = await app.get(OrdersService).place(customer.personId, {
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: store!.orgId,
      lines: [{ catalogItemId: itemId, qty }],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: ZAKUR },
    });
    expect(await board.next((e) => e.type === 'new_order')).toEqual({
      type: 'new_order',
      orderId: placed.id,
      merchantOrgId: store!.orgId,
    });
    expect(
      await board.next((e) => e.type === 'invalidate' && e.keys.includes('merchant.board')),
    ).toBeTruthy();
    board.close();

    expect(
      codeOf(
        await tap((h) =>
          staff.client.live.merchantBoard.subscribe({ merchantOrgId: other!.orgId }, h),
        ).ended(),
      ),
    ).toBe('forbidden');
  });

  it('the Console board needs a back-office role', async () => {
    const someone = await signIn('07715550009');
    expect(
      codeOf(
        await tap((h) =>
          someone.client.live.consoleBoard.subscribe({ cityId: 'aziziyah' }, h),
        ).ended(),
      ),
    ).toBe('forbidden');
    await app
      .get(IdentityService)
      .grantRole(SYSTEM, { personId: someone.personId, kind: 'dispatcher' });
    const t = tap((h) => someone.client.live.consoleBoard.subscribe({ cityId: 'aziziyah' }, h));
    expect(await t.next((e) => e.type === 'hello')).toMatchObject({
      channels: ['city:aziziyah', 'city:*'],
    });
    t.close();
  });
});
