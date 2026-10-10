import { createHash } from 'node:crypto';
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DriverError, type Actor, type AdjustInput, type AdjustResult, type PayDriverInput, type PayMerchantInput, type PayoutResult } from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService } from '../controls/index.js';
import { IdentityService } from '../identity/index.js';
import { AdjustmentService, MerchantCashService, settlementReference, type Adjustment } from '../ledger/index.js';
import { RefundApprovalsService, type RefundApprovalRecord } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { SupportService } from '../support/index.js';

const iqd = (n: number) => n.toLocaleString('en-US');

/** The settlement reference's sequence from the form's key: a retry of the same form is the same reference (and posts once). */
export function keySeq(idempotencyKey: string): number {
  return parseInt(createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 8), 16);
}

/**
 * Money out of the company, on the Console finance desk: paying a restaurant what it is owed, paying
 * a driver what the company owes him (G-86), and hand-written ledger corrections (G-85). The ledger
 * services own the rules (never more than owed, one movement at a time, a second finance person above
 * 25,000); this layer checks live roles, fixes the settlement reference and writes the audit row.
 * A correction above the line waits in the persisted second-OK queue (`support.refundApprovals`,
 * kind `adjustment`), so it survives a restart and any API instance can approve it.
 */
@Injectable()
export class MoneyOutService implements OnModuleInit, OnModuleDestroy {
  private unregister: (() => void) | null = null;

  constructor(
    private readonly merchantCash: MerchantCashService,
    private readonly adjustments: AdjustmentService,
    private readonly approvals: RefundApprovalsService,
    private readonly support: SupportService,
    private readonly identity: IdentityService,
    private readonly orgs: OrgsService,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.adjustments.linkIncidents((id) => this.support.ticketExists(id));
    this.unregister = this.approvals.register('adjustment', (row, approverId, tx) => this.postApproved(row, approverId, tx));
  }

  onModuleDestroy(): void {
    this.unregister?.();
  }

  async payMerchant(actor: Actor, input: z.output<typeof PayMerchantInput>): Promise<PayoutResult> {
    const reference = settlementReference('M', input.merchantId, this.clock.now(), keySeq(input.idempotencyKey));
    const left = await this.merchantCash.recordPayout({ merchantId: input.merchantId, amountIqd: input.amountIqd, channel: input.channel, reference });
    const name = await this.orgs.get(input.merchantId).then((o) => o.name).catch(() => input.merchantId);
    await this.uow.run((tx) =>
      this.audits.record(
        { cityId: input.cityId, actorId: actor.personId, action: 'finance.merchant_payout', subjectKind: 'merchant', subjectId: input.merchantId, summaryAr: `دفع لـ${name} ${iqd(input.amountIqd)} دينار (${reference})`, detail: { amountIqd: input.amountIqd, channel: input.channel, reference, leftIqd: left } },
        tx,
      ),
    );
    return { reference, amountIqd: input.amountIqd, leftIqd: left };
  }

  async payDriver(actor: Actor, input: z.output<typeof PayDriverInput>): Promise<PayoutResult> {
    const reference = settlementReference('D', input.driverId, this.clock.now(), keySeq(input.idempotencyKey));
    const left = await this.merchantCash.recordDriverPayout({ driverId: input.driverId, amountIqd: input.amountIqd, channel: input.channel, reference });
    await this.uow.run((tx) =>
      this.audits.record(
        { cityId: input.cityId, actorId: actor.personId, action: 'finance.driver_payout', subjectKind: 'driver', subjectId: input.driverId, summaryAr: `دفع للسايق ${iqd(input.amountIqd)} دينار (${reference})`, detail: { amountIqd: input.amountIqd, channel: input.channel, reference, leftIqd: left } },
        tx,
      ),
    );
    return { reference, amountIqd: input.amountIqd, leftIqd: left };
  }

  async adjust(actor: Actor, input: z.output<typeof AdjustInput>): Promise<AdjustResult> {
    const roles = await this.identity.activeRoles(actor.personId);
    let approvalId: string | null = null;
    const park = async (adj: Adjustment): Promise<Adjustment> => {
      const row = await this.uow.run(async (tx) => {
        const r = await this.approvals.request(
          { kind: 'adjustment', cityId: input.cityId, ticketId: null, orderId: null, amountIqd: adj.amountIqd, limitKind: 'adjustment', payload: { ...adj, requestedAt: adj.requestedAt.toISOString() }, requestedBy: actor.personId, idempotencyKey: `adjustment:${adj.id}` },
          tx,
        );
        await this.audits.record(
          { cityId: input.cityId, actorId: actor.personId, action: 'finance.adjustment_requested', subjectKind: 'ledger_adjustment', subjectId: adj.id, summaryAr: `تصحيح ${iqd(adj.amountIqd)} دينار ينتظر موافقة ثانية — ${adj.reason}`, detail: { ...this.detail(adj), refundApprovalId: r.id } },
          tx,
        );
        return r;
      });
      approvalId = row.id;
      return adj;
    };
    const adj = await this.adjustments.request({ personId: actor.personId, roles }, { amountIqd: input.amountIqd, fromAccount: input.fromAccount, toAccount: input.toAccount, reason: input.reason, incidentId: input.incidentId }, park);
    if (adj.status === 'posted') {
      await this.uow.run((tx) =>
        this.audits.record({ cityId: input.cityId, actorId: actor.personId, action: 'finance.adjustment_posted', subjectKind: 'ledger_adjustment', subjectId: adj.id, summaryAr: `صحّح الدفتر ${iqd(adj.amountIqd)} دينار — ${adj.reason}`, detail: this.detail(adj) }, tx),
      );
    }
    return { adjustmentId: adj.id, status: adj.status, amountIqd: adj.amountIqd, approvalId };
  }

  /** The second OK from the queue: the approver must hold finance now; the posting rides the decision's transaction. */
  private async postApproved(row: RefundApprovalRecord, approverId: string, tx: Tx): Promise<void> {
    const p = row.payload as unknown as Omit<Adjustment, 'requestedAt'> & { requestedAt: string };
    if (!p.id || !p.fromAccount || !p.toAccount) throw new DriverError('approval_not_found');
    const roles = await this.identity.activeRoles(approverId);
    await this.adjustments.approve({ personId: approverId, roles }, { ...p, requestedAt: new Date(p.requestedAt) }, tx);
  }

  private detail(adj: Adjustment): Record<string, unknown> {
    return { adjustmentId: adj.id, amountIqd: adj.amountIqd, fromAccount: adj.fromAccount, toAccount: adj.toAccount, incidentId: adj.incidentId, reason: adj.reason };
  }
}
