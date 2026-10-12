import { Injectable } from '@nestjs/common';
import type {
  Actor,
  ApprovalsInput,
  ApprovalsView,
  ControlRoomPort,
  DecideApprovalInput,
  DecideApprovalOutput,
  FinanceDeskView,
  FinanceInput,
  LaunchMetricsView,
  MetricsInput,
  SettlementExport,
  SettlementExportInput,
  AdjustInput,
  AdjustResult,
  PayDriverInput,
  PayMerchantInput,
  PayoutResult,
} from '@driver/contracts';
import type { z } from 'zod';
import { ApprovalsService } from './approvals.service.js';
import { FinanceDeskService } from './finance.service.js';
import { LaunchMetricsService } from './metrics.service.js';
import { MoneyOutService } from './money-out.service.js';

/** `ctx.controlRoom`: the approvals queue, the nightly cash desk and the metrics wall. */
@Injectable()
export class ControlRoomService implements ControlRoomPort {
  constructor(
    private readonly approvalsQueue: ApprovalsService,
    private readonly financeDesk: FinanceDeskService,
    private readonly launchMetrics: LaunchMetricsService,
    private readonly moneyOut: MoneyOutService,
  ) {}

  approvals(actor: Actor, input: z.output<typeof ApprovalsInput>): Promise<ApprovalsView> {
    return this.approvalsQueue.list(actor, input);
  }

  decide(actor: Actor, input: DecideApprovalInput): Promise<DecideApprovalOutput> {
    return this.approvalsQueue.decide(actor, input);
  }

  finance(actor: Actor, input: z.output<typeof FinanceInput>): Promise<FinanceDeskView> {
    return this.financeDesk.desk(actor, input.cityId);
  }

  exportSettlement(actor: Actor, input: z.output<typeof SettlementExportInput>): Promise<SettlementExport> {
    return this.financeDesk.exportCsv(actor, input);
  }

  payMerchant(actor: Actor, input: z.output<typeof PayMerchantInput>): Promise<PayoutResult> {
    return this.moneyOut.payMerchant(actor, input);
  }

  payDriver(actor: Actor, input: z.output<typeof PayDriverInput>): Promise<PayoutResult> {
    return this.moneyOut.payDriver(actor, input);
  }

  adjust(actor: Actor, input: z.output<typeof AdjustInput>): Promise<AdjustResult> {
    return this.moneyOut.adjust(actor, input);
  }

  metrics(input: z.output<typeof MetricsInput>): Promise<LaunchMetricsView> {
    return this.launchMetrics.wall(input);
  }
}
