import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { CatalogService } from './modules/catalog/index.js';
import { EventsService } from './modules/events/index.js';
import { IdentityService } from './modules/identity/index.js';
import { OpsService } from './modules/ops/index.js';
import { OrgsService } from './modules/orgs/index.js';

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
const ZAKUR_DOOR = { lat: 32.887, lng: 45.0765 };
type Client = ReturnType<typeof createTRPCClient<AppRouter>>;

/**
 * أكل بيت over the wire: a cook applies from the Merchant app, the Console queue shows it as
 * «مطبخ بيت», she can't approve it herself (even as field ops), another staff member approves it, and
 * her kitchen comes up as a home storefront on the home tier with her as owner.
 */
describe('home kitchen sign-up and activation (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  let seq = 0;
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  async function person(roles: RoleKind[] = []): Promise<{ client: Client; personId: string }> {
    seq += 1;
    const phone = `07718${String(seq).padStart(6, '0')}`;
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const res = await identity.verifyOtp({ phone, code: code!, device: { fingerprint: `hk-e2e-${phone}`, platform: 'web' } });
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

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0);
    const address = app.getHttpServer().address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('apply → «مطبخ بيت» in the queue → not her own to approve → another approves → home storefront on the home tier', async () => {
    // The cook also happens to be field ops: the queue still keeps her off her own application.
    const cookUser = await person(['field_ops']);
    const reviewer = await person(['field_ops']);
    const applied = await cookUser.client.ops.homeKitchenApply.mutate({ cityId: 'aziziyah', kitchenName: 'مطبخ أم حسين', cookName: 'أم حسين', door: ZAKUR_DOOR, landmark: 'قرب جامع الزكور' });
    expect(applied).toMatchObject({ state: 'submitted', kitchenName: 'مطبخ أم حسين', rejectReason: null });
    expect(await cookUser.client.ops.myHomeKitchenApplication.query()).toMatchObject({ state: 'submitted' });

    const mine = (await cookUser.client.approvals.list.query({ kind: 'merchant_onboarding' })).items.find((i) => i.title_ar === 'مطبخ أم حسين')!;
    expect(mine).toMatchObject({ ownItem: true, subtitle_ar: expect.stringMatching(/^مطبخ بيت · /) });
    const item = (await reviewer.client.approvals.list.query({ kind: 'merchant_onboarding' })).items.find((i) => i.refId === mine.refId)!;
    expect(item).toMatchObject({ ownItem: false, photos: [], compare: [] });
    expect(item.facts).toEqual(expect.arrayContaining([{ label_ar: 'النوع', value: 'مطبخ بيت' }, { label_ar: 'ملاحظات', value: 'قرب جامع الزكور' }]));

    expect(await codeOf(cookUser.client.approvals.decide.mutate({ kind: 'merchant_onboarding', refId: mine.refId, decision: 'approve' }))).toBe('approval_own_item');
    await reviewer.client.approvals.decide.mutate({ kind: 'merchant_onboarding', refId: mine.refId, decision: 'approve' });
    await app.get(EventsService).drain();

    const identity = app.get(IdentityService);
    const orgId = (await app.get(OpsService).onboardingRecord(mine.refId))!.orgId;
    expect(await identity.hasRole(cookUser.personId, 'merchant_owner', orgId)).toBe(true);
    expect(await app.get(CatalogService).storefront(orgId)).toMatchObject({ nameAr: 'مطبخ أم حسين', cuisineAr: 'أكل بيت', home: { monogram: null } });
    expect((await app.get(OrgsService).merchantSettings(orgId)).commissionTier).toBe('home');
    expect(await cookUser.client.ops.myHomeKitchenApplication.query()).toMatchObject({ state: 'active', kitchenName: 'مطبخ أم حسين' });
  });
});
