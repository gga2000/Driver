import { Injectable } from '@nestjs/common';
import type { DriverLedgerView, LedgerPort, MerchantBalanceView, NightlyReport, SettlementPlan } from '@driver/contracts';
import { Accounts } from './accounts.js';
import { CapsService } from './caps.js';
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
