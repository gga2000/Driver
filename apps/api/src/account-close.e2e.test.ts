import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { IdentityService } from './modules/identity/index.js';
import { owesSecondStep, passSecondStep } from './modules/identity/staff-totp.testing.js';
import { Accounts, LedgerService } from './modules/ledger/index.js';
import { NOTIFY_REPOSITORY, type NotifyRepository } from './modules/notify/notify.repository.js';
import { OrgsService } from './modules/orgs/index.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

/** Account deletion for partners and merchants over the wire (docs/api/account-close.md). */
describe('partner and merchant account close (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });
  type Client = ReturnType<typeof as>;

  async function signIn(phone: string, roles: RoleKind[] = []) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `e2e-${phone}`, platform: 'web' } });
    for (const kind of roles) await app.get(IdentityService).grantRole({ personId: 'system:e2e', sessionId: 'e2e' }, { personId: res.personId, kind });
    const client = as(res.tokens.accessToken);
    if (owesSecondStep(roles)) await passSecondStep(client, res.personId);
    return { client, personId: res.personId, isNew: res.isNew };
  }

  async function upload(client: Client): Promise<string> {
    const ticket = await client.places.photoUpload.mutate({ contentType: 'image/jpeg', sizeBytes: JPEG.length });
    expect((await fetch(new URL(ticket.uploadUrl, origin), { method: 'PUT', headers: ticket.headers, body: JPEG })).status).toBe(200);
    return ticket.uploadId;
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

  it('«احذف حسابي» opens one deletion case; the desk sees it', async () => {
    const courier = await signIn('07716660001', ['courier']);
    const desk = await signIn('07716660002', ['support']);
    const first = await courier.client.identity.requestDeletion.mutate({ note: 'تركت الشغل' });
    expect(first.alreadyOpen).toBe(false);
    const again = await courier.client.identity.requestDeletion.mutate({});
    expect(again).toMatchObject({ ticketId: first.ticketId, alreadyOpen: true });
    expect(await errCode(anon().identity.requestDeletion.mutate({}))).toBe('unauthorized');

    const list = await desk.client.support.list.query({ cityId: 'aziziyah' });
    const row = list.rows.find((x) => x.id === first.ticketId);
    expect(row).toMatchObject({ kind: 'deletion', kind_ar: 'حذف حساب', customerId: courier.personId, status: 'open' });
  });

  it('an admin closes a courier only when nothing is left, erasing his identity and files and keeping the ledger', async () => {
    const courier = await signIn('07716660011', ['courier']);
    const ops = await signIn('07716660012', ['field_ops']);
    const admin = await signIn('07716660013', ['admin']);
    const support = await signIn('07716660014', ['support']);
    const customer = await signIn('07716660015');
    await courier.client.identity.updateProfile.mutate({ name: 'حسن كاظم' });

    // His main photo, approved: its file is in storage and the vault points at it.
    const sent = await courier.client.driverAccount.setMainPhoto.mutate({ uploadId: await upload(courier.client) });
    await ops.client.approvals.decide.mutate({ kind: 'driver_document', refId: sent.latest!.documentId, decision: 'approve' });
    const photoUrl = (await courier.client.driverAccount.mainPhoto.query()).approved!.url;
    expect((await fetch(new URL(photoUrl, origin))).status).toBe(200);
    const { ticketId } = await courier.client.identity.requestDeletion.mutate({});
    // His phone gets pushes: one token from his session, one left over with no session.
    await courier.client.notify.registerDevice.mutate({ token: 'ExponentPushToken[close-e2e]', kind: 'expo', app: 'partner', platform: 'android' });
    const pushes = app.get<NotifyRepository>(NOTIFY_REPOSITORY);
    await pushes.upsertToken({ token: 'ExponentPushToken[close-e2e-old]', kind: 'expo', personId: courier.personId, sessionId: null, app: 'partner', platform: 'android', appVersion: null }, new Date());
    expect(await pushes.tokensOf(courier.personId)).toHaveLength(2);

    // He holds 5,000 دينار of cash: the close is refused until he hands it in.
    const ledger = app.get(LedgerService);
    await ledger.record({ type: 'cash_collected', amount: 5000, fromAccount: Accounts.cash(courier.personId), toAccount: 'customer:c_e2e_close', occurredAt: new Date(), idempotencyKey: `e2e:close:cash:${courier.personId}` });
    expect(await admin.client.identity.closeAccount.check.query({ personId: courier.personId })).toEqual({
      personId: courier.personId,
      closable: true,
      closedAt: null,
      blockers: [{ kind: 'cash_held', amountIqd: 5000 }],
    });
    expect(await errCode(admin.client.identity.closeAccount.close.mutate({ personId: courier.personId, note: 'طلب الحذف', ticketId }))).toBe('account_close_blocked');

    // Only an admin, never on himself, and only partner or merchant accounts.
    expect(await errCode(support.client.identity.closeAccount.close.mutate({ personId: courier.personId, note: 'طلب الحذف' }))).toBe('forbidden');
    expect(await errCode(support.client.identity.closeAccount.check.query({ personId: courier.personId }))).toBe('forbidden');
    expect(await errCode(admin.client.identity.closeAccount.close.mutate({ personId: customer.personId, note: 'طلب الحذف' }))).toBe('account_close_not_work');
    expect((await admin.client.identity.closeAccount.check.query({ personId: customer.personId })).closable).toBe(false);

    await ledger.record({ type: 'driver_settlement', amount: 5000, fromAccount: 'bank', toAccount: Accounts.cash(courier.personId), occurredAt: new Date(), idempotencyKey: `e2e:close:handin:${courier.personId}` });
    const closed = await admin.client.identity.closeAccount.close.mutate({ personId: courier.personId, note: 'طلب الحذف من التطبيق', ticketId });
    expect(closed).toMatchObject({ personId: courier.personId, closable: true, blockers: [], filesRemoved: 1 });
    expect(closed.closedAt).toBeInstanceOf(Date);

    // The file is gone, his sessions are gone, his name no longer resolves; the money book stays.
    expect((await fetch(new URL(photoUrl, origin))).status).toBe(404);
    expect(await errCode(courier.client.identity.me.query())).not.toBe('ok');
    expect(await app.get(IdentityService).firstNamesFor([courier.personId], admin.personId, 'console_names')).toEqual({});
    expect((await ledger.eventsFor(Accounts.cash(courier.personId))).length).toBe(2);
    expect(await pushes.tokensOf(courier.personId)).toEqual([]);
    const kase = await support.client.support.get.query({ ticketId });
    expect(kase.ticket.status).toBe('resolved');

    // Closing again is a no-op; the number is free: signing in with it makes a new account.
    expect((await admin.client.identity.closeAccount.close.mutate({ personId: courier.personId, note: 'مرة ثانية' })).filesRemoved).toBe(0);
    const back = await signIn('07716660011');
    expect(back.isNew).toBe(true);
    expect(back.personId).not.toBe(courier.personId);
  });

  it('a job he is on, or money not settled, stops the close too', async () => {
    const owner = await signIn('07716660021', ['merchant_owner']);
    const admin = await signIn('07716660022', ['admin']);
    await app.get(LedgerService).record({ type: 'driver_settlement', amount: 3000, fromAccount: 'platform', toAccount: Accounts.driver(owner.personId), occurredAt: new Date(), idempotencyKey: `e2e:close:earn:${owner.personId}` });
    expect((await admin.client.identity.closeAccount.check.query({ personId: owner.personId })).blockers).toEqual([{ kind: 'unpaid_settlement', amountIqd: 3000 }]);
  });

  it('the only owner of a store still taking orders is not closed until it is shut or has another owner', async () => {
    const owner = await signIn('07716660031');
    const partner = await signIn('07716660032');
    const admin = await signIn('07716660033', ['admin']);
    const orgs = app.get(OrgsService);
    const ids = app.get(IdentityService);
    const sys = { personId: 'system:e2e', sessionId: 'e2e' };
    const store = await orgs.create({ type: 'restaurant', name: 'مطعم التجربة', cityId: 'aziziyah', ownerId: owner.personId });
    await ids.grantRole(sys, { personId: owner.personId, kind: 'merchant_owner', orgId: store.id });
    const blockers = async () => (await admin.client.identity.closeAccount.check.query({ personId: owner.personId })).blockers;

    // Zero balance, but the store would be left taking orders with no owner.
    expect(await blockers()).toEqual([{ kind: 'sole_owner_of_open_store', count: 1 }]);
    expect(await errCode(admin.client.identity.closeAccount.close.mutate({ personId: owner.personId, note: 'طلب الحذف' }))).toBe('account_close_blocked');

    // A short pause that reopens by itself is not enough; closed until reopened by hand is.
    await orgs.setMerchantSettings(store.id, { closed: { reason: 'power_cut', note: null, at: new Date(), until: new Date(Date.now() + 20 * 60_000) } });
    expect(await blockers()).toEqual([{ kind: 'sole_owner_of_open_store', count: 1 }]);
    await orgs.setMerchantSettings(store.id, { closed: { reason: 'closing_early', note: null, at: new Date(), until: null } });
    expect(await blockers()).toEqual([]);

    // Or handed to another owner while it stays open.
    await orgs.setMerchantSettings(store.id, { closed: null });
    expect(await blockers()).toHaveLength(1);
    await ids.grantRole(sys, { personId: partner.personId, kind: 'merchant_owner', orgId: store.id });
    expect(await blockers()).toEqual([]);
    expect((await admin.client.identity.closeAccount.close.mutate({ personId: owner.personId, note: 'سلّم المحل لشريكه' })).closedAt).toBeInstanceOf(Date);
  });
});
