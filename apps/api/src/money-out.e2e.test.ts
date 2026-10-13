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
import type { LedgerIncidents } from './modules/ledger/incidents.js';
import { workedExample } from './modules/ledger/test-harness.js';
import { LEDGER_INCIDENTS } from './modules/ledger/tokens.js';
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

  it('a payout form retried after midnight UTC is still one payout; the same key with another amount is refused', async () => {
    const { orgId } = await restaurant('07800098013');
    const courier = await person('07720098014', 'مصطفى', ['courier']);
    await app.get(PostingService).orderMoney(workedExample({ orderId: 'mo-o3', merchantId: orgId, courierId: courier, occurredAt: clock.now() }));
    const room = app.get(ControlRoomService);
    const start = clock.now();
    clock.set('2026-10-06T23:59:30Z');
    const form = { cityId: 'aziziyah', merchantId: orgId, amountIqd: 5_000, channel: 'zaincash' as const, idempotencyKey: 'pay-merchant-midnight' };
    const first = await room.payMerchant(fin1, form);
    clock.set('2026-10-07T00:00:30Z');
    const again = await room.payMerchant(fin1, form);
    expect(again.reference).toBe(first.reference);
    expect(again.leftIqd).toBe(7_750);
    await expect(room.payMerchant(fin1, { ...form, amountIqd: 7_750 })).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    expect((await app.get(LedgerService).eventsFor(`merchant_cash:${orgId}`)).filter((e) => e.type === 'merchant_payout')).toHaveLength(1);
    expect((await app.get(MerchantCashService).balance(orgId)).balanceIqd).toBe(7_750);
    clock.set(start);
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

  describe('one finance person posts at most 50,000 a Baghdad day without a second OK', () => {
    let n = 0;
    async function setup(): Promise<{ who: { personId: string; sessionId: string }; base: { cityId: string; fromAccount: string; toAccount: string; reason: string; incidentId: string } }> {
      n += 1;
      const who = { personId: await person(`0770009810${n}`, 'زينب', ['finance']), sessionId: 'e2e' };
      const ticket = await app.get(SupportService).open(fin1, { cityId: 'aziziyah', kind: 'question', channel: 'phone', subject: 'تصحيحات اليوم' });
      return { who, base: { cityId: 'aziziyah', fromAccount: 'platform', toAccount: `merchant_cash:m_cap${n}`, reason: 'payout typed short by mistake', incidentId: ticket.id } };
    }

    it('20,000 and 20,000 post alone; a third 20,000 the same day waits for a second OK and says why', async () => {
      const { who, base } = await setup();
      const room = app.get(ControlRoomService);
      expect(await room.adjust(who, { ...base, amountIqd: 20_000 })).toMatchObject({ status: 'posted', queuedBecause: null });
      expect(await room.adjust(who, { ...base, amountIqd: 20_000 })).toMatchObject({ status: 'posted', queuedBecause: null });
      const third = await room.adjust(who, { ...base, amountIqd: 20_000 });
      expect(third).toMatchObject({ status: 'pending_second_approval', queuedBecause: 'daily_cap' });
      expect(third.approvalId).not.toBeNull();
      expect((await app.get(LedgerService).balance(base.toAccount)).amount).toBe(40_000);
      const [requested] = await audits(third.adjustmentId);
      expect(requested).toMatchObject({ action: 'finance.adjustment_requested', detail: { queuedBecause: 'daily_cap' } });
      // A small one that still fits under 50,000 posts alone.
      expect(await room.adjust(who, { ...base, amountIqd: 10_000 })).toMatchObject({ status: 'posted' });
      expect(await room.adjust(who, { ...base, amountIqd: 1 })).toMatchObject({ status: 'pending_second_approval', queuedBecause: 'daily_cap' });
    });

    it('a 30,000 correction still waits as before, for being above the line', async () => {
      const { who, base } = await setup();
      expect(await app.get(ControlRoomService).adjust(who, { ...base, amountIqd: 30_000 })).toMatchObject({ status: 'pending_second_approval', queuedBecause: 'above_line' });
    });

    it('corrections a colleague approved through the queue do not count toward the solo total', async () => {
      const { who, base } = await setup();
      const room = app.get(ControlRoomService);
      const support = app.get(SupportService);
      const big = await room.adjust(who, { ...base, amountIqd: 30_000 });
      await support.approveRefund(fin2, { id: big.approvalId! });
      await room.adjust(who, { ...base, amountIqd: 20_000 });
      await room.adjust(who, { ...base, amountIqd: 20_000 });
      const capped = await room.adjust(who, { ...base, amountIqd: 20_000 });
      expect(capped.queuedBecause).toBe('daily_cap');
      await support.approveRefund(fin2, { id: capped.approvalId! });
      expect((await app.get(LedgerService).balance(base.toAccount)).amount).toBe(90_000);
      // Solo so far: 40,000 (the 30,000 and the capped 20,000 were approved by fin2).
      expect(await room.adjust(who, { ...base, amountIqd: 10_000 })).toMatchObject({ status: 'posted' });
    });

    it('the next Baghdad day starts again from 0', async () => {
      const { who, base } = await setup();
      const room = app.get(ControlRoomService);
      const start = clock.now();
      clock.set('2026-10-06T20:00:00Z'); // 23:00 in Baghdad
      await room.adjust(who, { ...base, amountIqd: 25_000 });
      await room.adjust(who, { ...base, amountIqd: 25_000 });
      clock.set('2026-10-06T20:59:59Z');
      expect(await room.adjust(who, { ...base, amountIqd: 1_000 })).toMatchObject({ queuedBecause: 'daily_cap' });
      clock.set('2026-10-06T21:00:00Z'); // midnight in Baghdad, still 6 October in UTC
      expect(await room.adjust(who, { ...base, amountIqd: 25_000 })).toMatchObject({ status: 'posted' });
      expect(await room.adjust(who, { ...base, amountIqd: 25_000 })).toMatchObject({ status: 'posted' });
      clock.set(start);
    });

    it('two 20,000 corrections sent at once after a solo 20,000: at most one posts alone', async () => {
      const { who, base } = await setup();
      const room = app.get(ControlRoomService);
      await room.adjust(who, { ...base, amountIqd: 20_000 });
      const both = await Promise.all([room.adjust(who, { ...base, amountIqd: 20_000 }), room.adjust(who, { ...base, amountIqd: 20_000 })]);
      expect(both.map((r) => r.status).sort()).toEqual(['pending_second_approval', 'posted']);
      expect((await app.get(LedgerService).balance(base.toAccount)).amount).toBe(40_000);
    });
  });

  it('nobody pays out to, or corrects, his own account or a shop he belongs to', async () => {
    const room = app.get(ControlRoomService);
    const support = app.get(SupportService);
    // A finance person who also delivers and owns a restaurant.
    const self = { personId: await person('07700098021', 'حيدر', ['finance', 'courier']), sessionId: 'e2e' };
    await app.get(LedgerService).record({ type: 'tip', amount: 5_000, fromAccount: 'customer:c_e2e_own', toAccount: `driver:${self.personId}`, occurredAt: clock.now(), idempotencyKey: `e2e:own:${self.personId}` });
    await expect(room.payDriver(self, { cityId: 'aziziyah', driverId: self.personId, amountIqd: 5_000, channel: 'zaincash', idempotencyKey: 'pay-own-driver' })).rejects.toMatchObject({ code: 'staff_own_account' });
    const org = await app.get(OrgsService).create({ type: 'restaurant', name: 'مطعم حيدر', cityId: 'aziziyah', ownerId: self.personId });
    await app.get(PostingService).orderMoney(workedExample({ orderId: 'mo-own', merchantId: org.id, courierId: fin2.personId, occurredAt: clock.now() }));
    await expect(room.payMerchant(self, { cityId: 'aziziyah', merchantId: org.id, amountIqd: 1_000, channel: 'zaincash', idempotencyKey: 'pay-own-shop' })).rejects.toMatchObject({ code: 'staff_own_account' });
    const ticket = await support.open(fin1, { cityId: 'aziziyah', kind: 'question', channel: 'phone', subject: 'تصحيح' });
    const base = { cityId: 'aziziyah', fromAccount: 'platform', reason: 'missed delivery fee', incidentId: ticket.id };
    await expect(room.adjust(self, { ...base, toAccount: `driver:${self.personId}`, amountIqd: 1_000 })).rejects.toMatchObject({ code: 'staff_own_account' });
    await expect(room.adjust(self, { ...base, toAccount: `merchant_cash:${org.id}`, amountIqd: 1_000 })).rejects.toMatchObject({ code: 'staff_own_account' });
    expect((await app.get(LedgerService).balance(`driver:${self.personId}`)).amount).toBe(5_000);
    // Nor gives the second OK on a correction to his own account: it stays pending.
    const big = await room.adjust(fin1, { ...base, toAccount: `driver:${self.personId}`, amountIqd: 30_000 });
    await expect(support.approveRefund(self, { id: big.approvalId! })).rejects.toMatchObject({ code: 'staff_own_account' });
    expect((await app.get(LedgerService).balance(`driver:${self.personId}`)).amount).toBe(5_000);
    expect((await support.refundApprovals(fin2, { state: 'pending' })).find((r) => r.id === big.approvalId)?.state).toBe('pending');
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
    await expect(admin.moneyReceiveCourierCash(owner, { ...input, amountIqd: 3_750 })).rejects.toMatchObject({ code: 'idempotency_key_reused' });
    expect((await app.get(LedgerService).eventsFor(`cash:${courier}`)).filter((e) => e.type === 'merchant_paid_by_courier')).toHaveLength(1);
    expect((await app.get(MerchantCashService).balance(orgId)).balanceIqd).toBe(0);
    // An owner who also delivers can't take his own hand-in.
    await app.get(IdentityService).grantRole(SYSTEM, { personId: owner.personId, kind: 'courier' });
    const ownCode = (await app.get(DriverAccountService).handoverCode(owner)).code;
    await expect(admin.moneyReceiveCourierCash(owner, { ...input, courierId: owner.personId, code: ownCode, idempotencyKey: 'tablet-sheet-own' })).rejects.toMatchObject({ code: 'staff_own_account' });
    // Staff and other people cannot take it in the owner's name.
    await expect(admin.moneyReceiveCourierCash({ personId: courier, sessionId: 'e2e' }, { ...input, idempotencyKey: 'tablet-sheet-2' })).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('the tablet sheet sent twice at once (a double tap) posts one hand-over and opens no incident', async () => {
    const { orgId, owner } = await restaurant('07800098014');
    const courier = await person('07720098015', 'كرار', ['courier']);
    await app.get(PostingService).orderMoney(workedExample({ orderId: 'mo-o4', merchantId: orgId, courierId: courier, occurredAt: clock.now() }));
    const { code } = await app.get(DriverAccountService).handoverCode({ personId: courier, sessionId: 'e2e' });
    const admin = app.get(MerchantAdminService);
    const discrepancies = () => app.get<LedgerIncidents>(LEDGER_INCIDENTS).opened().filter((i) => i.kind === 'merchant_handover_discrepancy').length;
    const before = discrepancies();
    const input = { merchantOrgId: orgId, courierId: courier, amountIqd: 12_750, code, idempotencyKey: 'tablet-double-tap' };
    const [a, b] = await Promise.all([admin.moneyReceiveCourierCash(owner, input), admin.moneyReceiveCourierCash(owner, input)]);
    expect([a.balanceIqd, b.balanceIqd]).toEqual([0, 0]);
    expect((await app.get(LedgerService).eventsFor(`cash:${courier}`)).filter((e) => e.type === 'merchant_paid_by_courier')).toHaveLength(1);
    expect(discrepancies()).toBe(before);
  });
});
