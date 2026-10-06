import { Injectable } from '@nestjs/common';
import type { DriverLedgerView, GuaranteeWindowView, LedgerPort, MerchantBalanceView, NightlyReport, SettlementPlan } from '@driver/contracts';
import { Accounts } from './accounts.js';
import { CapsService } from './caps.js';
import { ShiftGuaranteeService } from './guarantee.js';
import { LedgerService } from './ledger.service.js';
import { MerchantCashService } from './merchant-cash.service.js';
import { NightlyJob } from './nightly.job.js';

/** The ledger's transport port (`ctx.ledger`): what the ledger router may call. Authorization happens in the router. */
@Injectable()
export class LedgerFacade implements LedgerPort {
  constructor(
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    private readonly merchantCash: MerchantCashService,
    private readonly nightly: NightlyJob,
    private readonly guarantee: ShiftGuaranteeService,
  ) {}

  async driverLedger(input: { driverId: string; from?: Date; to?: Date }): Promise<DriverLedgerView> {
    const range = { from: input.from, to: input.to };
    const [status, earnings, cash] = await Promise.all([
      this.caps.status(input.driverId),
      this.ledger.statement(Accounts.driver(input.driverId), range),
      this.ledger.statement(Accounts.cash(input.driverId), range),
    ]);
    return {
      driverId: input.driverId,
      role: status.role,
      tier: status.tier,
      earningsBalanceIqd: status.earningsIqd,
      cashBalanceIqd: status.cashIqd,
      owedIqd: status.owedIqd,
      capIqd: status.capIqd,
      capRemainingIqd: status.capRemainingIqd,
      overCap: status.overCap,
      payoutDueIqd: status.payoutDueIqd,
      earnings,
      cash,
    };
  }

  /** G-91: whether the shift guarantee covers him (city switch on, his cap role covered). */
  guaranteeCovers(driverId: string): Promise<boolean> {
    return this.guarantee.covers(driverId);
  }

  /** G-91: the peak shifts overlapping the range that have begun, with his numbers and paid status. */
  guaranteeWindows(input: { driverId: string; from: Date; to: Date }): Promise<GuaranteeWindowView[]> {
    return this.guarantee.windows(input.driverId, { from: input.from, to: input.to });
  }

  merchantBalance(merchantId: string): Promise<MerchantBalanceView> {
    return this.merchantCash.balance(merchantId);
  }

  requestSettlement(input: { merchantId: string; requestedBy: string }): Promise<SettlementPlan> {
    return this.merchantCash.requestSettlement(input.merchantId, input.requestedBy, 'merchant_request');
  }

  runNightly(input: { requestedBy: string }): Promise<NightlyReport> {
    return this.nightly.run({ requestedBy: input.requestedBy });
  }
}
