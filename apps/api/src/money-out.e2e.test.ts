import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { RoleKind } from '@driver/contracts';
import { AppModule } from './app.module.js';
import { ControlRoomService } from './modules/control-room/index.js';
import { AuditLogService } from './modules/controls/index.js';
import { DriverAccountService } from './modules/driver-account/index.js';
import { IdentityService } from './modules/identity/index.js';
import { LedgerService, MerchantCashService, PostingService } from './modules/ledger/index.js';
import { workedExample } from './modules/ledger/test-harness.js';
import { MerchantAdminService } from './modules/merchant-admin/index.js';
import { OrgsService } from './modules/orgs/index.js';
import { SupportService } from './modules/support/index.js';
import { CLOCK, FakeClock } from './shared/clock.js';

const SYSTEM = { personId: 'system:e2e', sessionId: 'e2e' };

/**
 * Money out through the app's own wiring: finance pays a restaurant and a driver (never more than
 * owed, a retried form posts once, every payout audited), a ledger correction with a second finance
 * person's OK through the persisted second-OK queue, and a restaurant taking its cash from a courier
 * on its tablet with the courier's daily code.
 */
describe('money out: payouts, corrections and the courier hand-over', () => {
  const clock = new FakeClock('2026-10-06T12:00:00Z');
  let app: INestApplication;
  let fin1: { personId: string; sessionId: string };
  let fin2: { personId: string; sessionId: string };

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(CLOCK).useValue(clock).compile();
    app = moduleRef.createNestApplication({ logger: ['error'] });
    await app.init();
    fin1 = { personId: await person('07700098001', 'سارة', ['finance']), sessionId: 'e2e' };
    fin2 = { personId: await person('07700098002', 'نور', ['finance']), sessionId: 'e2e' };
  });

  afterAll(async () => {
    await app.close();
    vi.useRealTimers();
  });

  async function person(phone: string, name: string, roles: RoleKind[], orgId?: string): Promise<string> {
    const identity = app.get(IdentityService);
    const id = await identity.ensurePersonByPhone(phone, 'system:e2e', 'e2e');
    await identity.updateProfile({ personId: id, sessionId: 'e2e' }, { name });
    for (const kind of roles) await identity.grantRole(SYSTEM, { personId: id, kind, ...(orgId ? { orgId } : {}) });
    return id;
  }

  async function restaurant(phone: string): Promise<{ orgId: string; owner: { personId: string; sessionId: string } }> {
    const ownerId = await person(phone, 'أبو علي', []);
    const org = await app.get(OrgsService).create({ type: 'restaurant', name: 'مطعم التجربة', cityId: 'aziziyah', ownerId });
    await app.get(IdentityService).grantRole(SYSTEM, { personId: ownerId, kind: 'merchant_owner', orgId: org.id });
    return { orgId: org.id, owner: { personId: ownerId, sessionId: 'e2e' } };
  }

  const audits = (subjectId: string) => app.get(AuditLogService).list({ subjectId, limit: 20 });

  it('finance pays a restaurant what it is owed, never more; a retried form is one payout', async () => {
    const { orgId } = await restaurant('07800098011');
    const courier = await person('07720098011', 'سيف', ['courier']);
    await app.get(PostingService).orderMoney(workedExample({ orderId: 'mo-o1', merchantId: orgId, courierId: courier, occurredAt: clock.now() }));
    const room = app.get(ControlRoomService);
    await expect(room.payMerchant(fin1, { cityId: 'aziziyah', merchantId: orgId, amountIqd: 20_000, channel: 'zaincash', idempotencyKey: 'pay-merchant-x' })).rejects.toMatchObject({ code: 'payout_exceeds_balance' });
    const first = await room.payMerchant(fin1, { cityId: 'aziziyah', merchantId: orgId, amountIqd: 12_750, channel: 'zaincash', idempotencyKey: 'pay-merchant-1' });
    expect(first).toMatchObject({ amountIqd: 12_750, leftIqd: 0 });
    expect(first.reference).toMatch(/^M-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const again = await room.payMerchant(fin1, { cityId: 'aziziyah', merchantId: orgId, amountIqd: 12_750, channel: 'zaincash', idempotencyKey: 'pay-merchant-1' });
    expect(again.reference).toBe(first.reference);
    expect((await app.get(LedgerService).eventsFor(`merchant_cash:${orgId}`)).filter((e) => e.type === 'merchant_payout')).toHaveLength(1);
    expect((await audits(orgId)).map((a) => a.action)).toContain('finance.merchant_payout');
  });

  it('finance pays a driver what the company owes him, never more', async () => {
    const driver = await person('07720098012', 'أحمد', ['courier']);
    await app.get(LedgerService).record({ type: 'tip', amount: 25_000, fromAccount: 'customer:c_e2e', toAccount: `driver:${driver}`, occurredAt: clock.now(), idempotencyKey: `e2e:pay:${driver}` });
    const room = app.get(ControlRoomService);
    await expect(room.payDriver(fin1, { cityId: 'aziziyah', driverId: driver, amountIqd: 30_000, channel: 'zaincash', idempotencyKey: 'pay-driver-x' })).rejects.toMatchObject({ code: 'payout_exceeds_due' });
    const r = await room.payDriver(fin1, { cityId: 'aziziyah', driverId: driver, amountIqd: 25_000, channel: 'agent', idempotencyKey: 'pay-driver-1' });
    expect(r).toMatchObject({ amountIqd: 25_000, leftIqd: 0 });
    expect((await app.get(LedgerService).balance(`driver:${driver}`)).amount).toBe(0);
    expect((await audits(driver)).map((a) => a.action)).toContain('finance.driver_payout');
  });

  it('a correction links a support ticket; above 25,000 it waits for a second finance person, then posts once', async () => {
    const ticket = await app.get(SupportService).open(fin1, { cityId: 'aziziyah', kind: 'question', channel: 'phone', subject: 'فرق بالكاش' });
    const room = app.get(ControlRoomService);
    const base = { cityId: 'aziziyah', fromAccount: 'platform', toAccount: 'merchant_cash:m_fix', reason: 'payout typed short by mistake', incidentId: ticket.id };
    await expect(room.adjust(fin1, { ...base, amountIqd: 1_000, incidentId: 'tk_nope' })).rejects.toMatchObject({ code: 'adjustment_incident_required' });
    const small = await room.adjust(fin1, { ...base, amountIqd: 1_000 });
    expect(small).toMatchObject({ status: 'posted', approvalId: null });
    expect((await audits(small.adjustmentId)).map((a) => a.action)).toEqual(['finance.adjustment_posted']);

    const big = await room.adjust(fin1, { ...base, amountIqd: 30_000 });
    expect(big).toMatchObject({ status: 'pending_second_approval' });
    expect(big.approvalId).not.toBeNull();
    expect((await app.get(LedgerService).balance('merchant_cash:m_fix')).amount).toBe(1_000);
    const support = app.get(SupportService);
    const pending = (await support.refundApprovals(fin2, { state: 'pending' })).find((r) => r.id === big.approvalId);
    expect(pending).toMatchObject({ kind: 'adjustment', amountIqd: 30_000, adjustment: { fromAccount: 'platform', toAccount: 'merchant_cash:m_fix', incidentId: ticket.id } });
    await expect(support.approveRefund(fin1, { id: big.approvalId! })).rejects.toMatchObject({ code: 'approval_own_item' });
    // Admin alone is not finance: the correction refuses to post and the request stays pending.
    const admin = { personId: await person('07700098003', 'علي', ['admin']), sessionId: 'e2e' };
    await expect(support.approveRefund(admin, { id: big.approvalId! })).rejects.toMatchObject({ code: 'forbidden' });
    await support.approveRefund(fin2, { id: big.approvalId! });
    expect((await app.get(LedgerService).balance('merchant_cash:m_fix')).amount).toBe(31_000);
    await expect(support.approveRefund(fin2, { id: big.approvalId! })).rejects.toMatchObject({ code: 'approval_state_conflict' });
    expect((await app.get(LedgerService).balance('merchant_cash:m_fix')).amount).toBe(31_000);
  });

  it('a restaurant takes its cash from a courier on its tablet with his daily code; a retry posts once', async () => {
    const { orgId, owner } = await restaurant('07800098012');
    const courier = await person('07720098013', 'زيد', ['courier']);
    await app.get(PostingService).orderMoney(workedExample({ orderId: 'mo-o2', merchantId: orgId, courierId: courier, occurredAt: clock.now() }));
    const { code } = await app.get(DriverAccountService).handoverCode({ personId: courier, sessionId: 'e2e' });
    const wrong = code === '0000' ? '0001' : '0000';
    const admin = app.get(MerchantAdminService);
    const input = { merchantOrgId: orgId, courierId: courier, amountIqd: 12_750, code, idempotencyKey: 'tablet-sheet-1' };
    await expect(admin.moneyReceiveCourierCash(owner, { ...input, code: wrong })).rejects.toMatchObject({ code: 'handover_code_invalid' });
    await expect(admin.moneyReceiveCourierCash(owner, { ...input, amountIqd: 20_000, idempotencyKey: 'tablet-sheet-0' })).rejects.toMatchObject({ code: 'handover_mismatch' });
    const after = await admin.moneyReceiveCourierCash(owner, input);
    expect(after.balanceIqd).toBe(0);
    expect(after.holders).toEqual([]);
    expect((await admin.moneyReceiveCourierCash(owner, input)).balanceIqd).toBe(0);
    expect((await app.get(LedgerService).eventsFor(`cash:${courier}`)).filter((e) => e.type === 'merchant_paid_by_courier')).toHaveLength(1);
    expect((await app.get(MerchantCashService).balance(orgId)).balanceIqd).toBe(0);
    // Staff and other people cannot take it in the owner's name.
    await expect(admin.moneyReceiveCourierCash({ personId: courier, sessionId: 'e2e' }, { ...input, idempotencyKey: 'tablet-sheet-2' })).rejects.toMatchObject({ code: 'forbidden' });
  });
});
