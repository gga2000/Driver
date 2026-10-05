import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { IdentityService } from './modules/identity/index.js';

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };
const KITCHEN = { lat: 32.9062, lng: 45.0612 };

/**
 * Location truth over the wire (maps program SP4a): the device path refuses a fake-GPS fix and support
 * gets one incident for it, however many times the phone tries.
 */
describe('location truth (e2e)', () => {
  let app: NestExpressApplication;
  let origin: string;
  let seq = 0;

  async function person(roles: RoleKind[]) {
    seq += 1;
    const phone = `07718${String(seq).padStart(6, '0')}`;
    const identity = app.get(IdentityService);
    await identity.requestOtp({ phone, purpose: 'login' });
    const { code } = await identity.devLastOtp(phone);
    const res = await identity.verifyOtp({ phone, code: code!, device: { fingerprint: `loc-e2e-${phone}`, platform: 'web' } });
    for (const kind of roles) await identity.grantRole(SYSTEM, { personId: res.personId, kind });
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: `${origin}/trpc`, transformer, headers: { authorization: `Bearer ${res.tokens.accessToken}` } })] });
    return { client, personId: res.personId };
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

  it('refuses fake GPS and opens one support incident for it', async () => {
    const courier = await person(['courier']);
    const agent = await person(['support']);
    const now = Date.now();
    const out = await courier.client.trips.reportPositions.mutate({
      fixes: [
        { pin: KITCHEN, at: new Date(now - 10_000), accuracyM: 9 },
        { pin: KITCHEN, at: new Date(now - 5_000), accuracyM: 9, mocked: true },
      ],
    });
    expect(out.rejected).toEqual([{ index: 1, reason: 'mocked' }]);
    await courier.client.trips.reportPosition.mutate({ pin: KITCHEN, at: new Date(now), mocked: true });
    const incidents = (await agent.client.support.list.query({})).rows.filter((r) => r.subject === 'موقع السايق مشكوك بيه');
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ kind: 'incident', channel: 'system' });
  });
});
