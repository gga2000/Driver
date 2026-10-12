import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DriverError, type Actor, type AdjustInput, type AdjustResult, type PayDriverInput, type PayMerchantInput, type PayoutResult } from '@driver/contracts';
import type { z } from 'zod';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { IdentityService } from '../identity/index.js';
import { AdjustmentService, MerchantCashService, keyedSettlementReference, type Adjustment, type ParkReason } from '../ledger/index.js';
import { RefundApprovalsService, type RefundApprovalRecord } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { SupportService } from '../support/index.js';

const iqd = (n: number) => n.toLocaleString('en-US');
/** The audit row of a correction posted with no second OK: the daily solo total is summed from these. */
const SOLO_POSTED = 'finance.adjustment_posted';
const ADJUSTMENT_SUBJECT = 'ledger_adjustment';

/**
 * Money out of the company, on the Console finance desk: paying a restaurant what it is owed, paying
 * a driver what the company owes him (G-86), and hand-written ledger corrections (G-85). The ledger
 * services own the rules (never more than owed, one movement at a time, a second finance person above
 * 25,000, and above 50,000 a day of one person's solo corrections); this layer checks live roles, fixes
 * the settlement reference and writes the audit row.
 * A correction above the line waits in the persisted second-OK queue (`support.refundApprovals`,
 * kind `adjustment`), so it survives a restart and any API instance can approve it.
 */
@Injectable()
export class MoneyOutService implements OnModuleInit, OnModuleDestroy {
  private unregister: (() => void) | null = null;
  /** One correction per finance person at a time, so his daily solo total can't be raced. */
  private readonly soloLock: DistributedKeyedLock;

  constructor(
    private readonly merchantCash: MerchantCashService,
    private readonly adjustments: AdjustmentService,
    private readonly approvals: RefundApprovalsService,
    private readonly support: SupportService,
    private readonly identity: IdentityService,
    private readonly orgs: OrgsService,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
  ) {
    this.soloLock = new DistributedKeyedLock(uow, 'finance.adjustment_solo');
  }

  onModuleInit(): void {
    this.adjustments.linkIncidents((id) => this.support.ticketExists(id));
    this.unregister = this.approvals.register('adjustment', (row, approverId, tx) => this.postApproved(row, approverId, tx));
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  async payMerchant(actor: Actor, input: z.output<typeof PayMerchantInput>): Promise<PayoutResult> {
    // Nobody pays out to a shop he belongs to: a colleague does.
    if (await this.memberOf(actor.personId, input.merchantId)) throw new DriverError('staff_own_account');
    const reference = keyedSettlementReference('M', input.merchantId, input.idempotencyKey);
    const name = await this.orgs.get(input.merchantId).then((o) => o.name).catch(() => input.merchantId);
    // The posting and its audit row commit together: no payout without its row on the audit log.
    const left = await this.uow.run(async (tx) => {
      const leftIqd = await this.merchantCash.recordPayout({ merchantId: input.merchantId, amountIqd: input.amountIqd, channel: input.channel, reference });
      await this.audits.record(
        { cityId: input.cityId, actorId: actor.personId, action: 'finance.merchant_payout', subjectKind: 'merchant', subjectId: input.merchantId, summaryAr: `دفع لـ${name} ${iqd(input.amountIqd)} دينار (${reference})`, detail: { amountIqd: input.amountIqd, channel: input.channel, reference, leftIqd } },
        tx,
      );
      return leftIqd;
    });
    return { reference, amountIqd: input.amountIqd, leftIqd: left };
  }

  async payDriver(actor: Actor, input: z.output<typeof PayDriverInput>): Promise<PayoutResult> {
    // A finance person who also drives is paid by a colleague.
    if (input.driverId === actor.personId) throw new DriverError('staff_own_account');
    const reference = keyedSettlementReference('D', input.driverId, input.idempotencyKey);
    const left = await this.uow.run(async (tx) => {
      const leftIqd = await this.merchantCash.recordDriverPayout({ driverId: input.driverId, amountIqd: input.amountIqd, channel: input.channel, reference });
      await this.audits.record(
        { cityId: input.cityId, actorId: actor.personId, action: 'finance.driver_payout', subjectKind: 'driver', subjectId: input.driverId, summaryAr: `دفع للسايق ${iqd(input.amountIqd)} دينار (${reference})`, detail: { amountIqd: input.amountIqd, channel: input.channel, reference, leftIqd } },
        tx,
      );
      return leftIqd;
    });
    return { reference, amountIqd: input.amountIqd, leftIqd: left };
  }

  async adjust(actor: Actor, input: z.output<typeof AdjustInput>): Promise<AdjustResult> {
    // A correction never touches an account of the person writing it (his own, or a shop he belongs to).
    for (const account of [input.fromAccount, input.toAccount]) if (await this.ownsAccount(actor.personId, account)) throw new DriverError('staff_own_account');
    const roles = await this.identity.activeRoles(actor.personId);
    let approvalId: string | null = null;
    let queuedBecause: ParkReason | null = null;
    const park = async (adj: Adjustment, why: ParkReason): Promise<Adjustment> => {
      const row = await this.uow.run(async (tx) => {
        const r = await this.approvals.request(
          { kind: 'adjustment', cityId: input.cityId, ticketId: null, orderId: null, amountIqd: adj.amountIqd, limitKind: 'adjustment', payload: { ...adj, requestedAt: adj.requestedAt.toISOString() }, requestedBy: actor.personId, idempotencyKey: `adjustment:${adj.id}` },
          tx,
        );
        const because = why === 'daily_cap' ? ' (يتجاوز حد التصحيحات اليومي بدون موافقة ثانية)' : '';
        await this.audits.record(
          { cityId: input.cityId, actorId: actor.personId, action: 'finance.adjustment_requested', subjectKind: 'ledger_adjustment', subjectId: adj.id, summaryAr: `تصحيح ${iqd(adj.amountIqd)} دينار ينتظر موافقة ثانية${because} — ${adj.reason}`, detail: { ...this.detail(adj), refundApprovalId: r.id, queuedBecause: why } },
          tx,
        );
        return r;
      });
      approvalId = row.id;
      queuedBecause = why;
      return adj;
    };
    // One person's corrections run one at a time (in process, and across API instances by an advisory
    // lock inside the transaction): today's solo total is read, the decision made, and the posting and
    // its audit row committed before his next correction reads the total.
    const adj = await this.soloLock.run(actor.personId, async (tx) => {
      const a = await this.adjustments.request(
        { personId: actor.personId, roles },
        { amountIqd: input.amountIqd, fromAccount: input.fromAccount, toAccount: input.toAccount, reason: input.reason, incidentId: input.incidentId },
        park,
        { tx, soloPostedToday: (day) => this.soloPostedToday(actor.personId, day, tx) },
      );
      if (a.status === 'posted') {
        await this.uow.run((t) =>
          this.audits.record({ cityId: input.cityId, actorId: actor.personId, action: SOLO_POSTED, subjectKind: ADJUSTMENT_SUBJECT, subjectId: a.id, summaryAr: `صحّح الدفتر ${iqd(a.amountIqd)} دينار — ${a.reason}`, detail: this.detail(a) }, t),
        );
      }
      return a;
    });
    return { adjustmentId: adj.id, status: adj.status, amountIqd: adj.amountIqd, approvalId, queuedBecause };
  }

  /**
   * What `personId` posted alone in `day`: the `finance.adjustment_posted` audit rows, which only a
   * correction that needed no second OK writes (an approved one is audited as `refund_approval.approved`).
   */
  private async soloPostedToday(personId: string, day: { from: Date; to: Date }, tx: Tx | undefined): Promise<number> {
    const rows = await this.audits.byActor({ actorId: personId, action: SOLO_POSTED, subjectKind: ADJUSTMENT_SUBJECT, from: day.from, to: day.to }, tx);
    return rows.reduce((sum, r) => sum + Math.abs(Number(r.detail['amountIqd']) || 0), 0);
  }

  /** The second OK from the queue: the approver must hold finance now; the posting rides the decision's transaction. */
  private async postApproved(row: RefundApprovalRecord, approverId: string, tx: Tx): Promise<void> {
    const p = row.payload as unknown as Omit<Adjustment, 'requestedAt'> & { requestedAt: string };
    if (!p.id || !p.fromAccount || !p.toAccount) throw new DriverError('approval_not_found');
    await this.refuseOwn(approverId, p);
    const roles = await this.identity.activeRoles(approverId);
    await this.adjustments.approve({ personId: approverId, roles }, { ...p, requestedAt: new Date(p.requestedAt) }, tx);
  }

  private async memberOf(personId: string, orgId: string): Promise<boolean> {
    const org = await this.orgs.get(orgId).catch(() => null);
    return Boolean(org?.members.some((m) => m.personId === personId));
  }

  /** `driver:`, `cash:` and `customer:` accounts are a person's; `merchant_cash:` and `household:` an org's. */
  private async ownsAccount(personId: string, account: string): Promise<boolean> {
    const [kind, id] = account.split(':');
    if (!id) return false;
    if (kind === 'driver' || kind === 'cash' || kind === 'customer') return id === personId;
    if (kind === 'merchant_cash' || kind === 'household') return this.memberOf(personId, id);
    return false;
  }

  /** The second OK: the approver may not own an account the correction touches either. */
  private async refuseOwn(approverId: string, p: { fromAccount: string; toAccount: string }): Promise<void> {
    for (const account of [p.fromAccount, p.toAccount]) if (await this.ownsAccount(approverId, account)) throw new DriverError('staff_own_account');
  }

  private detail(adj: Adjustment): Record<string, unknown> {
    return { adjustmentId: adj.id, amountIqd: adj.amountIqd, fromAccount: adj.fromAccount, toAccount: adj.toAccount, incidentId: adj.incidentId, reason: adj.reason };
  }
}
