import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { transformer, type AppRouter, type RoleKind } from '@driver/contracts';
import { createApp } from './bootstrap.js';
import { IdentityService } from './modules/identity/index.js';
import { PostingService } from './modules/ledger/index.js';

/** Ledger router over the wire (plan Step 6 acceptance, minus the Console pages). */
describe('ledger router smoke', () => {
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

  async function login(phone: string, roles: Array<{ kind: RoleKind; orgId?: string }> = []) {
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    await anon.identity.requestOtp.mutate({ phone, purpose: 'login' });
    const { code } = await anon.identity.devLastOtp.query({ phone });
    const res = await anon.identity.verifyOtp.mutate({ phone, code: code! });
    for (const r of roles) await app.get(IdentityService).grantRole({ personId: 'system:test' }, { personId: res.personId, ...r });
    const client = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer, headers: { authorization: `Bearer ${res.tokens.accessToken}` } })] });
    return { personId: res.personId, client };
  }

  const codeOf = (e: unknown) => {
    const data = (e as { data?: { code?: string; httpStatus?: number } }).data;
    return data ? `${data.code}/${data.httpStatus}` : undefined;
  };

  it('a courier reads his own book with Arabic labels and cap; others and anonymous are refused', async () => {
    const courier = await login('07712345101', [{ kind: 'courier' }]);
    await app.get(PostingService).orderMoney({
      orderId: 'smoke-o1',
      orderType: 'food',
      occurredAt: new Date('2026-10-03T12:00:00Z'),
      customerId: 'smoke-c1',
      payment: 'cash',
      merchantId: 'smoke-m1',
      courierId: courier.personId,
      itemsSubtotalIqd: 15000,
      commissionTier: 'featured',
      serviceFeeIqd: 500,
      deliveryFeeIqd: 1000,
    });
    const book = await courier.client.ledger.driverLedger.query({});
    expect(book).toMatchObject({ driverId: courier.personId, role: 'courier', tier: 'bronze', owedIqd: 15500, capIqd: 75000, capRemainingIqd: 59500, overCap: false });
    expect(book.earnings.lines.map((l) => l.label_ar)).toEqual(['أجور التوصيل']);
    expect(book.cash.lines.map((l) => [l.label_ar, l.amountIqd])).toEqual([['كاش مستلم', -16500]]);

    const other = await login('07712345102');
    expect(codeOf(await other.client.ledger.driverLedger.query({ driverId: courier.personId }).catch((e: unknown) => e))).toBe('forbidden/403');
    const anon = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url, transformer })] });
    expect(codeOf(await anon.ledger.driverLedger.query({}).catch((e: unknown) => e))).toBe('unauthorized/401');
  });

  it('merchant staff see their live balance and "اطلب فلوسك"; a stranger cannot', async () => {
    const owner = await login('07712345103', [{ kind: 'merchant_owner', orgId: 'smoke-m1' }]);
    const view = await owner.client.ledger.merchantBalance.query({ merchantId: 'smoke-m1' });
    expect(view).toMatchObject({ balanceIqd: 12750, mode: 'nightly_courier', exposureCapIqd: 300000 });
    expect(view.holders).toHaveLength(1);
    const plan = await owner.client.ledger.requestSettlement.mutate({ merchantId: 'smoke-m1' });
    expect(plan).toMatchObject({ channel: 'courier', amountIqd: 12750, reason: 'merchant_request' });
    expect(codeOf(await owner.client.ledger.merchantBalance.query({ merchantId: 'smoke-m2' }).catch((e: unknown) => e))).toBe('forbidden/403');
    const err = await owner.client.ledger.requestSettlement.mutate({ merchantId: 'smoke-none' }).catch((e: unknown) => e);
    expect(codeOf(err)).toBe('forbidden/403');
    // Back office may ask on a merchant's behalf; nothing due is a 409 with its own code.
    const fin = await login('07712345106', [{ kind: 'finance' }]);
    expect(codeOf(await fin.client.ledger.requestSettlement.mutate({ merchantId: 'smoke-empty' }).catch((e: unknown) => e))).toBe('settlement_nothing_due/409');
  });

  it('runNightly: finance gets "الدفتر متوازن"; a customer is forbidden', async () => {
    const customer = await login('07712345104');
    expect(codeOf(await customer.client.ledger.runNightly.mutate().catch((e: unknown) => e))).toBe('forbidden/403');
    const fin = await login('07712345105', [{ kind: 'finance' }]);
    const report = await fin.client.ledger.runNightly.mutate();
    expect(report.ok).toBe(true);
    expect(report.message_ar).toBe('الدفتر متوازن');
    expect(report.drivers.length).toBeGreaterThanOrEqual(1);
  });
});
