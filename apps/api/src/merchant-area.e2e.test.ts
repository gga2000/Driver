import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { AZIZIYAH_RESTAURANTS } from '@driver/contracts/seeds';
import { createApp } from './bootstrap.js';
import { CatalogService, seedStorefronts } from './modules/catalog/index.js';
import { IdentityService } from './modules/identity/index.js';
import { OrgsService } from './modules/orgs/index.js';

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };

/**
 * «منطقة التوصيل» and «منين زبائنك» (maps program r5, r6) through the real app: the merchant module's
 * zones, pricing and controls wiring, the router's role gate and the store scope, over HTTP.
 */
describe('merchant delivery area over tRPC (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  const client = (accessToken?: string) =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: `${origin}/trpc`, transformer, ...(accessToken ? { headers: { authorization: `Bearer ${accessToken}` } } : {}) })],
    });
  const codeOf = (err: unknown) => (err instanceof TRPCClientError ? (err.data as { code?: string } | undefined)?.code : String(err));

  async function signIn(phone: string) {
    const c = client();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `area-${phone}`, platform: 'web' } });
    return { api: client(res.tokens.accessToken), personId: res.personId };
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('staff read their store’s zones with server fees, the owner his customers’ areas; others are refused', async () => {
    const [store, other] = await seedStorefronts(app.get(OrgsService), app.get(CatalogService), AZIZIYAH_RESTAURANTS.slice(0, 2).map((r) => ({ ...r, hours: [] })), 'area-owner');
    await app.get(OrgsService).settled();
    const staff = await signIn('07715551001');
    await app.get(IdentityService).grantRole(SYSTEM, { personId: staff.personId, kind: 'merchant_staff', orgId: store!.orgId });

    const area = await staff.api.merchant.deliveryArea.query({ merchantOrgId: store!.orgId });
    expect(area.kitchen?.zoneKey).toBe(AZIZIYAH_RESTAURANTS[0]!.zoneKey);
    expect(area.zones.length).toBeGreaterThan(20);
    expect(area.bands.length).toBeGreaterThan(1);
    expect(area.zones.every((z) => z.feeIqd !== null && z.service === 'open' && z.feeIqd === area.bands[z.band!]!.feeIqd)).toBe(true);
    expect(area.zones.filter((z) => z.kitchen)).toHaveLength(1);

    // «منين زبائنك» is the owner's (Ali 2026-10-07): staff are refused, the owner reads it.
    expect(await staff.api.merchant.customerZones.query({ merchantOrgId: store!.orgId }).then(() => 'ok', codeOf)).toBe('forbidden');
    const owner = await signIn('07715551003');
    await app.get(IdentityService).grantRole(SYSTEM, { personId: owner.personId, kind: 'merchant_owner', orgId: store!.orgId });
    const customers = await owner.api.merchant.customerZones.query({ merchantOrgId: store!.orgId });
    expect(customers).toMatchObject({ days: 30, minOrders: 5, zones: [], otherOrders: 0, totalOrders: 0 });

    expect(await staff.api.merchant.deliveryArea.query({ merchantOrgId: other!.orgId }).then(() => 'ok', codeOf)).toBe('forbidden');
    const customer = await signIn('07715551002');
    expect(await customer.api.merchant.deliveryArea.query({ merchantOrgId: store!.orgId }).then(() => 'ok', codeOf)).toBe('forbidden');
    expect(await client().merchant.customerZones.query({ merchantOrgId: store!.orgId }).then(() => 'ok', codeOf)).toBe('unauthorized');
  });
});
