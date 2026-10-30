import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink, TRPCClientError } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { IdentityService } from './modules/identity/index.js';
import { totpCode, totpStep } from './modules/identity/totp.js';

/**
 * Admin and finance sign-in's authenticator step over the wire (docs/api/staff-totp.md): the role gate
 * itself refuses those roles to a session that only passed the SMS code.
 */
describe('staff authenticator step (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  let seq = 0;
  const anon = () => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer })] });
  const as = (token: string) => createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${token}` } })] });

  async function signIn(phone: string) {
    const c = anon();
    await c.identity.requestOtp.mutate({ phone });
    const { code } = await c.identity.devLastOtp.query({ phone });
    const res = await c.identity.verifyOtp.mutate({ phone, code: code!, device: { fingerprint: `totp-e2e-${phone}`, platform: 'web' } });
    return { client: as(res.tokens.accessToken), personId: res.personId, secondStep: res.secondStep ?? null };
  }

  /** A fresh person with `roles`, signed in again afterwards so the session is a staff sign-in. */
  async function staff(roles: RoleKind[]) {
    seq += 1;
    const phone = `07716${String(seq).padStart(6, '0')}`;
    const first = await signIn(phone);
    for (const kind of roles) await app.get(IdentityService).grantRole({ personId: 'system:e2e' }, { personId: first.personId, kind });
    return { ...first, phone };
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

  it('an SMS-only session is refused every finance and admin procedure until the code passes', async () => {
    const fin = await staff(['finance']);
    expect(await errCode(fin.client.ledger.runNightly.mutate())).toBe('totp_required');
    expect(await errCode(fin.client.finance.desk.query({ cityId: 'aziziyah' }))).toBe('totp_required');
    // The session itself still works for everything else.
    expect((await fin.client.identity.me.query()).secondStep).toBe('enrol');

    const { secret, uri } = await fin.client.identity.authenticator.enrol.mutate();
    expect(uri).toMatch(/^otpauth:\/\/totp\/Driver%3AConsole\?secret=[A-Z2-7]+&issuer=Driver/);
    const { recoveryCodes } = await fin.client.identity.authenticator.confirm.mutate({ code: totpCode(secret, totpStep(new Date())) });
    expect(recoveryCodes).toHaveLength(8);
    expect(await errCode(fin.client.ledger.runNightly.mutate())).toBe('ok');
    expect((await fin.client.identity.me.query()).secondStep).toBeNull();

    // A new sign-in owes a code again: the step belongs to the session, not the person.
    const again = await signIn(fin.phone);
    expect(again.secondStep).toBe('code');
    expect(await errCode(again.client.ledger.runNightly.mutate())).toBe('totp_required');
    expect(await errCode(again.client.identity.authenticator.verify.mutate({ code: recoveryCodes[0]! }))).toBe('ok');
    expect(await errCode(again.client.ledger.runNightly.mutate())).toBe('ok');
  });

  it('an admin who is also a dispatcher keeps the dispatcher desk; admin-only stays shut', async () => {
    const both = await staff(['admin', 'dispatcher']);
    expect(await errCode(both.client.finance.desk.query({ cityId: 'aziziyah' }))).toBe('ok');
    expect(await errCode(both.client.identity.authenticator.locks.query())).toBe('totp_required');
    expect(await errCode(both.client.identity.endAllSessions.mutate({ personId: both.personId }))).toBe('totp_required');
  });

  it('support and customers never meet the step; the demo code is off outside the demo', async () => {
    const support = await staff(['support']);
    expect((await support.client.identity.me.query()).secondStep).toBeNull();
    expect(await errCode(support.client.identity.authenticator.enrol.mutate())).toBe('forbidden');
    const admin = await staff(['admin']);
    expect(await admin.client.identity.authenticator.demoCode.query()).toEqual({ code: null });
  });

  it('an admin resets another staff member with his own fresh code; never his own', async () => {
    const admin = await staff(['admin']);
    const { secret } = await admin.client.identity.authenticator.enrol.mutate();
    const step = totpStep(new Date());
    await admin.client.identity.authenticator.confirm.mutate({ code: totpCode(secret, step) });
    const fin = await staff(['finance']);
    const f = await fin.client.identity.authenticator.enrol.mutate();
    await fin.client.identity.authenticator.confirm.mutate({ code: totpCode(f.secret, totpStep(new Date())) });

    expect(await errCode(admin.client.identity.authenticator.reset.mutate({ personId: admin.personId, code: totpCode(secret, step + 1) }))).toBe('forbidden');
    expect(await errCode(admin.client.identity.authenticator.reset.mutate({ personId: fin.personId, code: '000000' }))).toBe('totp_invalid');
    expect(await admin.client.identity.authenticator.reset.mutate({ personId: fin.personId, code: totpCode(secret, step + 1) })).toEqual({ reset: true, ended: 1 });
    // His old session is gone; his next sign-in sets the app up again.
    expect(await errCode(fin.client.identity.me.query())).toBe('session_expired');
    expect((await signIn(fin.phone)).secondStep).toBe('enrol');
  });
});
