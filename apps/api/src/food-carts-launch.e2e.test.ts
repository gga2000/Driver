import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { AZIZIYAH_ZONES, transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { CatalogService } from './modules/catalog/index.js';
import { ConfigService } from './modules/config/index.js';
import { FoodCartsService, seedDemoCarts } from './modules/food-carts/index.js';
import { IdentityService } from './modules/identity/index.js';
import { OrgsService } from './modules/orgs/index.js';

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
type Client = ReturnType<typeof createTRPCClient<AppRouter>>;
const pinIn = (zoneKey: string) => {
  const z = AZIZIYAH_ZONES.find((x) => x.id === zoneKey)!;
  return { lat: z.lat, lng: z.lng };
};

/**
 * Opening food carts from the Console (Ali, 2026-10-12: "open them, and add an option to open and close
 * them in the consol"): the `launch` switch gates every new cart order on the server (quote, place,
 * walk-over, follow), a kill switch still beats an open row, with no row the city file decides, and only
 * an admin opens.
 */
describe('food carts launch switch (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  let seq = 0;
  let liver: { orgId: string; cartId: string };
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  async function person(roles: RoleKind[] = []): Promise<{ client: Client; personId: string }> {
    seq += 1;
    const phone = `07718${String(seq).padStart(6, '0')}`;
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const res = await identity.verifyOtp({ phone, code: code!, device: { fingerprint: `fc-launch-${phone}`, platform: 'web' } });
    await identity.updateProfile({ personId: res.personId, sessionId: 'e2e' }, { name: `موظف ${seq}` });
    for (const kind of roles) await identity.grantRole(SYSTEM, { personId: res.personId, kind });
    return { client: as(res.tokens.accessToken), personId: res.personId };
  }

  const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return 'ok';
    } catch (err) {
      if (!(err instanceof TRPCClientError)) throw err;
      return (err.data as { code?: string } | undefined)?.code;
    }
  };

  const cartOrder = () => ({
    cityId: 'aziziyah',
    type: 'food' as const,
    merchantOrgId: liver.orgId,
    lines: [{ catalogItemId: `${liver.orgId}_laffa`, qty: 1 }],
    paymentMethod: 'cash' as const,
    dropoff: { zoneKey: 'zakur', pin: pinIn('zakur') },
  });

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
    const seeded = await seedDemoCarts(app.get(OrgsService), app.get(CatalogService), app.get(FoodCartsService), { ownerId: 'fc-launch-owner' });
    liver = seeded.find((c) => c.key === 'liver')!;
    await app.get(OrgsService).settled();
  });

  afterAll(async () => {
    await app.close();
  });

  it('with no row the city file decides; closed refuses quote, place, walk-over and follow; open allows them', async () => {
    const admin = await person(['admin']);
    const customer = await person();
    const config = app.get(ConfigService);

    // No launch row yet: Aziziyah's file opens carts.
    expect(config.foodCartsOpen('aziziyah')).toBe(true);
    const [row] = await admin.client.ops.controls.launches.query({ cityId: 'aziziyah' });
    expect(row).toMatchObject({ key: 'food_carts', open: true, fromDefault: true });
    expect((await customer.client.foodCarts.list.query({})).launched).toBe(true);
    expect((await customer.client.orders.quote.query(cartOrder())).totalIqd).toBeGreaterThan(0);

    // Closed from the Console: every new-work path refuses.
    const closed = await admin.client.ops.controls.setLaunch.mutate({ cityId: 'aziziyah', key: 'food_carts', open: false, reason: 'مشكلة بالطلبات' });
    expect(closed).toMatchObject({ open: false, fromDefault: false, reason: 'مشكلة بالطلبات' });
    expect(await codeOf(customer.client.orders.quote.query(cartOrder()))).toBe('service_paused');
    expect(await codeOf(customer.client.orders.place.mutate(cartOrder()))).toBe('service_paused');
    expect(await codeOf(customer.client.foodCarts.walkups.place.mutate({ cartId: liver.cartId, lines: [{ itemId: `${liver.orgId}_laffa`, qty: 1, choices: [] }] }))).toBe('service_paused');
    expect(await codeOf(customer.client.foodCarts.follow.mutate({ cartId: liver.cartId, on: true }))).toBe('service_paused');
    expect((await customer.client.foodCarts.list.query({})).launched).toBe(false);

    // The audit log carries who, why and which way.
    const audit = await admin.client.ops.controls.audit.query({ subjectKind: 'launch' });
    expect(audit[0]).toMatchObject({ action: 'launch.set', subjectId: 'food_carts' });
    expect(audit[0]!.summary_ar).toContain('مشكلة بالطلبات');

    // Open again: the row wins over the file either way.
    await admin.client.ops.controls.setLaunch.mutate({ cityId: 'aziziyah', key: 'food_carts', open: true, reason: 'تصلّحت' });
    expect((await customer.client.orders.quote.query(cartOrder())).totalIqd).toBeGreaterThan(0);
    expect(await codeOf(customer.client.foodCarts.follow.mutate({ cartId: liver.cartId, on: true }))).toBe('ok');
  });

  it('a kill switch on the cart still stops it while carts are open', async () => {
    const admin = await person(['admin']);
    const customer = await person();
    await admin.client.ops.controls.setLaunch.mutate({ cityId: 'aziziyah', key: 'food_carts', open: true, reason: 'مفتوحة' });
    await admin.client.ops.controls.setSwitch.mutate({ scope: 'restaurant', key: liver.orgId, active: true, reason: 'عطل' });
    expect(await codeOf(customer.client.orders.quote.query(cartOrder()))).toBe('service_paused');
    await admin.client.ops.controls.setSwitch.mutate({ scope: 'restaurant', key: liver.orgId, active: false, reason: 'تصلّح' });
    await admin.client.ops.controls.setSwitch.mutate({ scope: 'vertical', key: 'food', active: true, reason: 'مطر' });
    expect(await codeOf(customer.client.orders.quote.query(cartOrder()))).toBe('service_paused');
    await admin.client.ops.controls.setSwitch.mutate({ scope: 'vertical', key: 'food', active: false, reason: 'خلص' });
    expect((await customer.client.orders.quote.query(cartOrder())).totalIqd).toBeGreaterThan(0);
  });

  it('only an admin opens; a dispatcher may close', async () => {
    const admin = await person(['admin']);
    const dispatcher = await person(['dispatcher']);
    const support = await person(['support']);
    expect(await codeOf(support.client.ops.controls.setLaunch.mutate({ key: 'food_carts', open: false, reason: 'تجربة' }))).toBe('forbidden');
    expect(await codeOf(dispatcher.client.ops.controls.setLaunch.mutate({ key: 'food_carts', open: false, reason: 'زحمة' }))).toBe('ok');
    expect(await codeOf(dispatcher.client.ops.controls.setLaunch.mutate({ key: 'food_carts', open: true, reason: 'نفتحها' }))).toBe('forbidden');
    expect(await codeOf(admin.client.ops.controls.setLaunch.mutate({ key: 'food_carts', open: true, reason: 'نفتحها' }))).toBe('ok');
  });
});
