import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { Accounts, LedgerService } from './modules/ledger/index.js';
import { OrgsService } from './modules/orgs/index.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const STREET_30 = { lat: 32.9095, lng: 45.0635 };

/** M3 account surfaces over the wire: places (with a real photo PUT/GET), profile, wallet, households. */
describe('customer account API (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  async function signIn(phone: string) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `e2e-${phone}`, platform: 'web' } });
    return { client: as(res.tokens.accessToken), personId: res.personId };
  }

  const errCode = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'ok';
    } catch (err) {
      return err instanceof TRPCClientError ? (err.data as { code?: string } | undefined)?.code : String(err);
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

  it('places: upload a gate photo, save, list with the photo, confirm; another customer sees and touches nothing', async () => {
    const ali = await signIn('07713330001');
    const other = await signIn('07713330002');
    const ticket = await ali.client.places.photoUpload.mutate({ contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const put = await fetch(new URL(ticket.uploadUrl, origin), { method: 'PUT', headers: ticket.headers, body: JPEG });
    expect(put.status).toBe(200);
    const forged = await fetch(new URL(ticket.uploadUrl.replace(/sig=[^&]+/, 'sig=forged'), origin), { method: 'PUT', headers: ticket.headers, body: JPEG });
    expect(forged.status).toBe(400);

    const saved = await ali.client.places.save.mutate({ label: 'home', name: 'البيت', pin: STREET_30, note: 'باب أخضر', photoIds: [ticket.uploadId] });
    expect(saved).toMatchObject({ zoneId: 'street_30', zoneName_ar: 'شارع 30', confirmed: false, access: 'owner' });
    const img = await fetch(new URL(saved.photos[0]!.url, origin));
    expect(img.status).toBe(200);
    expect(Buffer.from(await img.arrayBuffer()).equals(JPEG)).toBe(true);
    expect((await fetch(new URL(`/files/${ticket.uploadId}`, origin))).status).toBe(404);

    expect((await ali.client.places.mine.query()).map((p) => p.id)).toEqual([saved.id]);
    expect(await other.client.places.mine.query()).toEqual([]);
    expect(await errCode(other.client.places.update.mutate({ placeId: saved.id, name: 'لي' }))).toBe('place_not_found');
    expect(await errCode(other.client.places.remove.mutate({ placeId: saved.id }))).toBe('place_not_found');
    expect(await errCode(other.client.places.save.mutate({ label: 'home', name: 'x', pin: STREET_30, photoIds: [ticket.uploadId] }))).toBe('upload_invalid');
    expect(await errCode(ali.client.places.save.mutate({ label: 'custom', name: 'بغداد', pin: { lat: 33.31, lng: 44.36 } }))).toBe('outside_zone');
    expect(await errCode(anon().places.mine.query())).toBe('unauthorized');

    const confirmed = await ali.client.places.confirm.mutate({ placeId: saved.id, pin: STREET_30, accuracyM: 10 });
    expect(confirmed.confirmed).toBe(true);
    expect(await ali.client.places.zoneFor.query({ pin: { lat: 32.887, lng: 45.0765 } })).toMatchObject({ zoneId: 'zakur', inService: true });
  });

  it('profile: updateProfile writes the vault; me reads it back', async () => {
    const ali = await signIn('07713330003');
    const me = await ali.client.identity.updateProfile.mutate({ name: 'علي', emergencyContact: { name: 'أمي', phone: '07801112233' } });
    expect(me).toMatchObject({ name: 'علي', emergencyContact: { name: 'أمي', phoneMasked: '+96478*****33' } });
    expect((await ali.client.identity.me.query()).name).toBe('علي');
    expect(await errCode(ali.client.identity.updateProfile.mutate({} as never))).toBe('invalid_input');
  });

  it('wallet and household: balance with points worth, readable lines, approvals by the payer only', async () => {
    const ali = await signIn('07713330004');
    const minar = await signIn('07713330005');
    const ledger = app.get(LedgerService);
    await ledger.recordAll([
      { id: `e2e:topup:${ali.personId}`, kind: 'money', occurredAt: new Date(), refs: {}, lines: [{ type: 'credit_issued', amount: 10_000, fromAccount: Accounts.bank, toAccount: Accounts.customer(ali.personId), memo: 'topup:agent' }], controls: [] },
      { id: `e2e:pts:${ali.personId}`, kind: 'points', occurredAt: new Date(), refs: {}, lines: [{ type: 'points_earned', amount: 2_500, fromAccount: Accounts.pointsPool, toAccount: Accounts.points(ali.personId) }], controls: [] },
    ]);
    expect(await ali.client.wallet.balance.query()).toMatchObject({ moneyIqd: 10_000, points: 2_500, pointsWorthIqd: 25_000, pendingPoints: 0, household: null });
    expect(await minar.client.wallet.balance.query()).toMatchObject({ moneyIqd: 0, points: 0 });
    const lines = (await ali.client.wallet.transactions.query({ limit: 10 })).lines;
    expect(lines.map((l) => l.title_ar).sort()).toEqual(['شحن رصيد', 'نقاط مكتسبة']);
    expect((await ali.client.wallet.topupOptions.query()).channels.find((c) => c.id === 'zaincash')?.available).toBe(false);

    const home = await ali.client.household.create.mutate({ name: 'بيت علي' });
    await ali.client.household.inviteMember.mutate({ householdId: home.id, phone: '07713330005', spendingLimitIqd: 25_000 });
    const req = await app.get(OrgsService).requestPayerApproval({ orgId: home.id, orderId: 'ord_e2e', requestedBy: minar.personId, amountIqd: 31_000 });
    expect((await ali.client.household.mine.query())?.pendingApprovals.map((a) => a.id)).toEqual([req.id]);
    expect(await errCode(minar.client.household.approve.mutate({ requestId: req.id }))).toBe('household_payer_only');
    expect((await ali.client.household.approve.mutate({ requestId: req.id })).state).toBe('approved');
    expect((await ali.client.wallet.balance.query()).household).toMatchObject({ id: home.id, role: 'payer', balanceIqd: 0 });
  });
});
