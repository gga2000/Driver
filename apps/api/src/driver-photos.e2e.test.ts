import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { IdentityService } from './modules/identity/index.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

/** Driver photos over the wire (Ali, 2026-10-06): the main photo through the approvals queue, and a guardian's child photo. */
describe('driver photos API (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });
  type Client = ReturnType<typeof as>;

  async function signIn(phone: string, roles: Array<'courier' | 'field_ops'> = []) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `e2e-${phone}`, platform: 'web' } });
    for (const kind of roles) await app.get(IdentityService).grantRole({ personId: 'system:e2e', sessionId: 'e2e' }, { personId: res.personId, kind });
    return { client: as(res.tokens.accessToken), personId: res.personId };
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

  it('driverAccount.setMainPhoto → approvals queue → approved; customers cannot read his photo state', async () => {
    const courier = await signIn('07715550001', ['courier']);
    const ops = await signIn('07715550002', ['field_ops']);
    const customer = await signIn('07715550003');
    expect(await courier.client.driverAccount.mainPhoto.query()).toEqual({ state: 'none', approved: null, latest: null });
    expect(await errCode(customer.client.driverAccount.mainPhoto.query())).toBe('forbidden');
    expect(await errCode(customer.client.driverAccount.setMainPhoto.mutate({ uploadId: await upload(customer.client) }))).toBe('forbidden');

    const sent = await courier.client.driverAccount.setMainPhoto.mutate({ uploadId: await upload(courier.client) });
    expect(sent).toMatchObject({ state: 'pending', approved: null, latest: { status: 'pending' } });
    // His own photo opens through its signed URL.
    expect((await fetch(new URL(sent.latest!.url!, origin))).status).toBe(200);

    const item = (await ops.client.approvals.list.query({ kind: 'driver_document' })).items.find((i) => i.refId === sent.latest!.documentId)!;
    expect(item).toMatchObject({ title_ar: 'الصورة الرئيسية', subtitle_ar: 'تبين للزبائن بعد الموافقة', photos: [expect.objectContaining({ url: expect.stringContaining('/files/') })] });
    await ops.client.approvals.decide.mutate({ kind: 'driver_document', refId: item.refId, decision: 'approve' });
    const ok = await courier.client.driverAccount.mainPhoto.query();
    expect(ok).toMatchObject({ state: 'approved', approved: { url: expect.stringContaining('/files/') } });

    // A second one rejected with a reason: «مرفوضة: …», the approved one stays.
    const again = await courier.client.driverAccount.setMainPhoto.mutate({ uploadId: await upload(courier.client) });
    await ops.client.approvals.decide.mutate({ kind: 'driver_document', refId: again.latest!.documentId, decision: 'reject', reason: 'الوجه مو واضح' });
    expect(await courier.client.driverAccount.mainPhoto.query()).toMatchObject({ state: 'rejected', approved: { url: ok.approved!.url }, latest: { rejectReason: 'الوجه مو واضح' } });
  });

  it('khat.guardian: the guardian adds and removes his child photo; nobody else can', async () => {
    const guardian = await signIn('07715550011');
    const stranger = await signIn('07715550012');
    const { childRef } = await guardian.client.identity.registerChild.mutate({ name: 'زينب علي' });
    expect(await guardian.client.khat.guardian.children.query()).toEqual([{ childRef, name: 'زينب علي', photoUrl: null }]);
    expect(await stranger.client.khat.guardian.children.query()).toEqual([]);
    expect(await errCode(anon().khat.guardian.children.query())).toBe('unauthorized');

    expect(await errCode(stranger.client.khat.guardian.setPhoto.mutate({ childRef, uploadId: await upload(stranger.client) }))).toBe('forbidden');
    const child = await guardian.client.khat.guardian.setPhoto.mutate({ childRef, uploadId: await upload(guardian.client) });
    expect(child.photoUrl).toContain('/files/');
    expect((await fetch(new URL(child.photoUrl!, origin))).status).toBe(200);
    expect(await errCode(stranger.client.khat.guardian.removePhoto.mutate({ childRef }))).toBe('forbidden');

    const removed = await guardian.client.khat.guardian.removePhoto.mutate({ childRef });
    expect(removed.photoUrl).toBeNull();
    // The bytes are gone: the old signed URL no longer opens.
    expect((await fetch(new URL(child.photoUrl!, origin))).status).not.toBe(200);
  });
});
