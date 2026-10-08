import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { IdentityService } from './modules/identity/index.js';

describe('API smoke', () => {
  let app: NestExpressApplication;
  let url: string;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    const port = typeof address === 'object' && address ? address.port : 0;
    url = `http://127.0.0.1:${port}/trpc`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and answers health.ping', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const res = await client.health.ping.query();
    expect(res.ok).toBe(true);
    expect(res.service).toBe('driver-api');
    // No DATABASE_URL / REDIS_URL in unit tests: the API still answers and reports both as unavailable.
    expect(['ok', 'unavailable']).toContain(res.db);
    expect(['ok', 'unavailable']).toContain(res.redis);
    if (!process.env['DATABASE_URL']) expect(res.db).toBe('unavailable');
    if (!process.env['REDIS_URL']) expect(res.redis).toBe('unavailable');
  });

  it('health.live answers 200 with a database and 503 without one; health.ready always answers', async () => {
    const live = await fetch(`${url}/health.live`);
    expect(live.status).toBe(process.env['DATABASE_URL'] ? 200 : 503);
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const ready = await client.health.ready.query();
    expect(ready.service).toBe('driver-api');
    expect(ready.ok).toBe(ready.db === 'ok' && ready.redis === 'ok');
    if (!process.env['DATABASE_URL']) expect(ready.db).toBe('unavailable');
    if (!process.env['REDIS_URL']) expect(ready.ok).toBe(false);
  });

  it('serves a quote for an Aziziyah taxi trip over the wire', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const quote = await client.pricing.quote.query({
      cityId: 'aziziyah',
      vertical: 'taxi',
      stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: 'zakur', type: 'dropoff' }],
      options: { doorPickup: true },
      at: new Date('2026-10-02T09:00:00Z'),
      distanceKm: 3,
      durationMin: 9,
    });
    expect(quote.total).toBe(5000);
    expect(quote.shadowComponents.map((c) => c.key)).toEqual(['distance', 'time']);
  });

  it('identity: requestOtp → devLastOtp → verifyOtp → me, over the wire', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const phone = '07712340001';
    const req = await anon.identity.requestOtp.mutate({ phone, purpose: 'login' });
    expect(req.phoneMasked).toBe('+96477*****01');
    expect(req.resendAfterSec).toBe(30);
    const { code } = await anon.identity.devLastOtp.query({ phone });
    expect(code).toMatch(/^\d{6}$/);
    const login = await anon.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: 'smoke-device-001', platform: 'web' } });
    expect(login.isNew).toBe(true);

    const authed = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url, transformer, headers: { authorization: `Bearer ${login.tokens.accessToken}` } })],
    });
    const me = await authed.identity.me.query();
    expect(me.personId).toBe(login.personId);
    expect(me.phoneMasked).toBe('+96477*****01');
    expect(me.roles.map((r) => r.kind)).toEqual(['customer']);
    expect(me.reverificationRequired).toBe(false);

    // Same phone in another format from "another browser": same person, not a new one.
    const second = await anon.identity.requestOtp.mutate({ phone: '+964 771 234 0001', purpose: 'login' });
    expect(second.phoneMasked).toBe('+96477*****01');
    const secondCode = (await anon.identity.devLastOtp.query({ phone: '9647712340001' })).code!;
    const secondLogin = await anon.identity.verifyOtp.mutate({ phone: '+964 771 234 0001', code: secondCode });
    expect(secondLogin.isNew).toBe(false);
    expect(secondLogin.personId).toBe(login.personId);

    const rotated = await anon.identity.refresh.mutate({ refreshToken: login.tokens.refreshToken });
    expect(rotated.refreshToken).not.toBe(login.tokens.refreshToken);
    await authed.identity.logout.mutate({ refreshToken: rotated.refreshToken });
    const afterLogout = await authed.identity.me.query().catch((e: unknown) => e);
    expect((afterLogout as { data?: { code?: string } }).data?.code).toBe('session_expired');
  });

  it('protected procedure without a token → UNAUTHORIZED with an Arabic message and retry hint', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const err = (await anon.identity.me.query().catch((e: unknown) => e)) as { message: string; data: { code: string; httpStatus: number; message_ar: string; retryHint: string } };
    expect(err.data.httpStatus).toBe(401);
    expect(err.data.code).toBe('unauthorized');
    expect(err.data.message_ar).toMatch(/[؀-ۿ]/);
    expect(err.data.retryHint).toBe('never');
    expect(err.message).toBe(err.data.message_ar);
    expect(JSON.stringify(err.data)).not.toContain('stack');
  });

  it('admin-only procedure → FORBIDDEN for a plain customer', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const phone = '07712340002';
    await anon.identity.requestOtp.mutate({ phone, purpose: 'login' });
    const { code } = await anon.identity.devLastOtp.query({ phone });
    const login = await anon.identity.verifyOtp.mutate({ phone, code: code! });
    const authed = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url, transformer, headers: { authorization: `Bearer ${login.tokens.accessToken}` } })],
    });
    const err = (await authed.identity.grantRole.mutate({ personId: login.personId, kind: 'admin' }).catch((e: unknown) => e)) as { data: { code: string; httpStatus: number } };
    expect(err.data.httpStatus).toBe(403);
    expect(err.data.code).toBe('forbidden');
  });

  it('orders and trips routers: a customer places and cancels a ride; the trip board is ops-only', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const phone = '07712340003';
    await anon.identity.requestOtp.mutate({ phone, purpose: 'login' });
    const { code } = await anon.identity.devLastOtp.query({ phone });
    const login = await anon.identity.verifyOtp.mutate({ phone, code: code! });
    const authed = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url, transformer, headers: { authorization: `Bearer ${login.tokens.accessToken}` } })],
    });
    // The fare is the server's quote right now (night/peak fees apply after 22:00 Baghdad), never a constant.
    const quote = await authed.pricing.quote.query({ cityId: 'aziziyah', vertical: 'taxi', stops: [{ zoneId: 'centre', type: 'pickup' }, { zoneId: 'street_30', type: 'dropoff' }], options: { doorPickup: false, streetHandover: false }, at: new Date() });
    const order = await authed.orders.place.mutate({ cityId: 'aziziyah', type: 'ride', fareIqd: quote.total, pickup: { zoneKey: 'centre' }, dropoff: { zoneKey: 'street_30' } });
    expect(order).toMatchObject({ state: 'placed', totalIqd: quote.total, ordererId: login.personId });
    expect((await authed.orders.mine.query()).map((o) => o.id)).toEqual([order.id]);
    expect((await authed.orders.cancellationPreview.query({ orderId: order.id })).free).toBe(true);
    expect((await authed.orders.cancel.mutate({ orderId: order.id })).state).toBe('customer_cancelled');
    const err = (await authed.trips.board.query({ cityId: 'aziziyah' }).catch((e: unknown) => e)) as { data: { code: string; httpStatus: number } };
    expect(err.data.httpStatus).toBe(403);
    expect(err.data.code).toBe('forbidden');
  });

  it('dispatch: board/override/setPolicy need dispatcher or admin; respond needs a driver role', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const unauth = (await anon.dispatch.board.query({ cityId: 'aziziyah' }).catch((e: unknown) => e)) as { data: { httpStatus: number } };
    expect(unauth.data.httpStatus).toBe(401);

    const phone = '07712340003';
    await anon.identity.requestOtp.mutate({ phone, purpose: 'login' });
    const { code } = await anon.identity.devLastOtp.query({ phone });
    const login = await anon.identity.verifyOtp.mutate({ phone, code: code! });
    const authed = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url, transformer, headers: { authorization: `Bearer ${login.tokens.accessToken}` } })],
    });
    const forbidden = (await authed.dispatch.board.query({ cityId: 'aziziyah' }).catch((e: unknown) => e)) as { data: { httpStatus: number; code: string } };
    expect(forbidden.data.code).toBe('forbidden');
    const notDriver = (await authed.dispatch.respond.mutate({ offerId: 'x', accept: true }).catch((e: unknown) => e)) as { data: { code: string } };
    expect(notDriver.data.code).toBe('forbidden');

    await app.get(IdentityService).grantRole({ personId: 'system' }, { personId: login.personId, kind: 'dispatcher' });
    const board = await authed.dispatch.board.query({ cityId: 'aziziyah' });
    expect(board.cards).toEqual([]);
    expect(board.policies.find((p) => p.vertical === 'taxi')).toEqual({ vertical: 'taxi', policy: 'smart_broadcast', suggestOnly: false, overridden: false });
    expect(await authed.dispatch.setPolicy.mutate({ cityId: 'aziziyah', vertical: 'taxi', suggestOnly: true })).toEqual({
      vertical: 'taxi',
      policy: 'smart_broadcast',
      suggestOnly: true,
      overridden: true,
    });
    expect((await authed.dispatch.board.query({ cityId: 'aziziyah' })).policies.find((p) => p.vertical === 'taxi')?.suggestOnly).toBe(true);
    await authed.dispatch.setPolicy.mutate({ cityId: 'aziziyah', vertical: 'taxi', clear: true });
    const missing = (await authed.dispatch.override.mutate({ tripId: 'nope', driverId: 'd1' }).catch((e: unknown) => e)) as { data: { code: string; message_ar: string; httpStatus: number } };
    expect(missing.data.code).toBe('dispatch_not_found');
    // A DriverError thrown in a resolver keeps its status over the wire (was 500 before the v11 result fix).
    expect(missing.data.httpStatus).toBe(404);
    expect(missing.data.message_ar).toMatch(/[؀-ۿ]/);
  });

  it('console reads: wired end to end and refused to customers', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const phone = '07712340009';
    await anon.identity.requestOtp.mutate({ phone, purpose: 'login' });
    const { code } = await anon.identity.devLastOtp.query({ phone });
    const login = await anon.identity.verifyOtp.mutate({ phone, code: code! });
    const authed = createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url, transformer, headers: { authorization: `Bearer ${login.tokens.accessToken}` } })],
    });
    const refused = (await authed.console.rightNow.query({ cityId: 'aziziyah' }).catch((e: unknown) => e)) as { data: { code: string } };
    expect(refused.data.code).toBe('forbidden');

    await app.get(IdentityService).grantRole({ personId: 'system' }, { personId: login.personId, kind: 'support' });
    const now = await authed.console.rightNow.query({ cityId: 'aziziyah' });
    expect(now).toMatchObject({ cityId: 'aziziyah', activeDrivers: 0, cashInFieldIqd: 0 });
    expect(now.at).toBeInstanceOf(Date);
    expect((await authed.dispatch.drivers.query({ cityId: 'aziziyah' })).drivers).toEqual([]);
    expect((await authed.drivers.list.query({ cityId: 'aziziyah' })).rows).toEqual([]);
    expect((await authed.orders.search.query({ cityId: 'aziziyah', states: ['customer_cancelled'] })).rows.length).toBeGreaterThanOrEqual(0);
    expect(await authed.orders.events.query({ orderId: 'nope' })).toEqual([]);
    expect(await authed.trips.events.query({ tripId: 'nope' })).toEqual([]);
    expect((await authed.system.outbox.query()).recentFailed).toEqual([]);
    expect(await authed.merchants.list.query({ cityId: 'aziziyah' })).toEqual([]);
    expect(await authed.system.simulator.status.query()).toMatchObject({ available: true, running: false, drivers: 0 });
  });

  it('returns the city config and null for unknown cities', async () => {
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    const city = await client.config.city.query({ cityId: 'aziziyah' });
    expect(city?.name_ar).toBe('العزيزية');
    expect(await client.config.city.query({ cityId: 'nowhere' })).toBeNull();
  });

  // Keep last: it uses up this client IP's OTP allowance for the hour.
  it('W5: identity.requestOtp is limited per device over the wire (rate_limited + retryAfterSec), never per client IP', async () => {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    type Refusal = { data: { code: string; httpStatus: number; retryAfterSec?: number } };
    // One shared IP (carrier NAT): twelve different people from 127.0.0.1 all get their code.
    for (let i = 0; i < 12; i += 1) await anon.identity.requestOtp.mutate({ phone: `0771250${String(i).padStart(4, '0')}`, purpose: 'login' });
    // One device: the 6th code in the hour is refused.
    const device = { fingerprint: 'smoke-device-1', platform: 'android' as const };
    let refused = null as Refusal | null;
    let sent = 0;
    for (let i = 0; i < 7 && !refused; i += 1) {
      try {
        await anon.identity.requestOtp.mutate({ phone: `0771260${String(i).padStart(4, '0')}`, purpose: 'login', device });
        sent += 1;
      } catch (e) {
        refused = e as Refusal;
      }
    }
    expect(sent).toBe(5);
    expect(refused?.data).toMatchObject({ code: 'rate_limited', httpStatus: 429, retryAfterSec: expect.any(Number) });
    expect(refused!.data.retryAfterSec!).toBeGreaterThan(3500);
  });
});
