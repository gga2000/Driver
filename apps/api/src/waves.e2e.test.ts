import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { createApp } from './bootstrap.js';
import { CatalogService, seedStorefronts } from './modules/catalog/index.js';
import { IdentityService } from './modules/identity/index.js';
import { OrgsService } from './modules/orgs/index.js';

const ZAKUR = { lat: 32.887, lng: 45.0765 };
const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
type Client = ReturnType<typeof createTRPCClient<AppRouter>>;

/**
 * Customer waves over the wire (W5): a zone's open places, the waitlist answer on `access.status`,
 * `orders.place` refusing a waiting customer with friendly Arabic, and ops raising the number.
 */
describe('customer waves (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  let seq = 0;
  let khalid: Awaited<ReturnType<typeof seedStorefronts>>[number];
  const as = (token: string) =>
    createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: `${origin}/trpc`,
          transformer,
          headers: { authorization: `Bearer ${token}` },
        }),
      ],
    });

  async function person(roles: RoleKind[] = []): Promise<{ client: Client; personId: string }> {
    seq += 1;
    const phone = `07718${String(seq).padStart(6, '0')}`;
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const res = await identity.verifyOtp({
      phone,
      code: code!,
      device: { fingerprint: `waves-e2e-${phone}`, platform: 'web' },
    });
    for (const kind of roles) await identity.grantRole(SYSTEM, { personId: res.personId, kind });
    return { client: as(res.tokens.accessToken), personId: res.personId };
  }
  /** A new customer whose home is in Zakur. */
  async function customer(): Promise<Client> {
    const { client } = await person();
    await client.places.save.mutate({
      cityId: 'aziziyah',
      label: 'home',
      name: 'البيت',
      pin: ZAKUR,
      shareWithHousehold: false,
    });
    return client;
  }
  const order = (client: Client) =>
    client.orders.place.mutate({
      cityId: 'aziziyah',
      type: 'food',
      merchantOrgId: khalid.orgId,
      lines: [{ catalogItemId: khalid.itemIds.get('liver_plate')!, qty: 1 }],
      paymentMethod: 'cash',
      dropoff: { zoneKey: 'zakur', pin: ZAKUR },
    });
  const errOf = async (
    p: Promise<unknown>,
  ): Promise<{ code: string | undefined; message: string }> => {
    try {
      await p;
      return { code: 'ok', message: '' };
    } catch (err) {
      if (!(err instanceof TRPCClientError)) throw err;
      const data = err.data as { code?: string; message_ar?: string } | undefined;
      return { code: data?.code, message: data?.message_ar ?? err.message };
    }
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    khalid = (
      await seedStorefronts(
        app.get(OrgsService),
        app.get(CatalogService),
        AZIZIYAH_RESTAURANTS.slice(0, 1).map((r) => ({ ...r, hours: [] })),
        'waves-owner',
      )
    )[0]!;
    await app.get(OrgsService).settled();
  });

  afterAll(async () => {
    await app.close();
  });

  it('with no wave set everyone orders as before', async () => {
    const c = await customer();
    expect(await c.access.status.query()).toMatchObject({ state: 'open' });
    expect((await order(c)).id).toBeTruthy();
  });

  it('a waiting customer is told so and cannot order food until ops opens more places', async () => {
    const dispatcher = await person(['dispatcher']);
    const nosy = await customer();
    expect(
      (await errOf(nosy.ops.waves.setSlots.mutate({ zoneKey: 'zakur', openSlots: 100 }))).code,
    ).toBe('forbidden');

    // the customer of the test above is already in: one place, taken
    await dispatcher.client.ops.waves.setSlots.mutate({ zoneKey: 'zakur', openSlots: 1 });
    const late = await customer();
    expect(await late.access.status.query()).toMatchObject({
      state: 'waiting',
      zoneKey: 'zakur',
      ahead: 0,
    });
    expect(await errOf(order(late))).toEqual({
      code: 'waitlisted',
      message: 'لسه ما وصل دور منطقتك. نبلّغك أول ما يصير دورك',
    });

    const view = await dispatcher.client.ops.waves.view.query({});
    expect(view.zones.find((z) => z.zoneKey === 'zakur')).toMatchObject({
      openSlots: 1,
      admitted: 1,
      waiting: 1,
    });

    await dispatcher.client.ops.waves.setSlots.mutate({ zoneKey: 'zakur', openSlots: 2 });
    expect(await late.access.status.query()).toMatchObject({ state: 'open' });
    expect((await order(late)).id).toBeTruthy();
    const audit = await dispatcher.client.ops.controls.audit.query({ subjectKind: 'wave' });
    expect(audit.map((a) => a.summary_ar)).toContain('دور زاكور: 2 زبون');
  });
});
