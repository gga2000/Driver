import { AZIZIYAH_MONEY_RULES, type MoneyRules, type OrderMoneyPayload } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AdjustmentService } from './adjustments.service.js';
import { CapsService, StaticCapProfiles } from './caps.js';
import { RecordingLedgerBus } from './events.adapter.js';
import { LedgerIncidents } from './incidents.js';
import { LedgerFacade } from './ledger.facade.js';
import { LedgerService } from './ledger.service.js';
import { registerLedgerSubscribers } from './ledger.subscribers.js';
import { MerchantCashService } from './merchant-cash.service.js';
import { InMemoryMerchantSettingsRepository } from './merchant-settings.repository.js';
import { NightlyJob } from './nightly.job.js';
import { PostingService } from './posting.service.js';
import { InMemoryLedgerRepository, type LedgerRepository } from './repository.js';

/** The whole ledger module on in-memory everything, subscribers registered on a recording bus. */
export function ledgerHarness(opts: { start?: string; rules?: MoneyRules; repo?: LedgerRepository } = {}) {
  const clock = new FakeClock(opts.start ?? '2026-10-03T12:00:00Z');
  const rules = opts.rules ?? AZIZIYAH_MONEY_RULES;
  const repo = opts.repo ?? new InMemoryLedgerRepository();
  const bus = new RecordingLedgerBus();
  const incidents = new LedgerIncidents(bus, clock);
  const profiles = new StaticCapProfiles();
  const ledger = new LedgerService(repo);
  const caps = new CapsService(ledger, rules, profiles);
  const settings = new InMemoryMerchantSettingsRepository();
  const merchantCash = new MerchantCashService(ledger, settings, bus, incidents, clock, rules);
  const posting = new PostingService(ledger, merchantCash, rules);
  const adjustments = new AdjustmentService(ledger, incidents, clock, rules);
  const nightly = new NightlyJob(ledger, caps, incidents, bus, clock, rules);
  const facade = new LedgerFacade(ledger, caps, merchantCash, nightly);
  registerLedgerSubscribers(bus, posting, merchantCash);
  return { clock, rules, repo, bus, incidents, profiles, ledger, caps, settings, merchantCash, posting, adjustments, nightly, facade };
}

/** The money spec's worked example: 15,000 of food at the featured 15 % tier, across town. */
export function workedExample(over: Partial<OrderMoneyPayload> = {}): OrderMoneyPayload {
  return {
    orderId: 'o1',
    orderType: 'food',
    occurredAt: new Date('2026-10-03T12:00:00Z'),
    customerId: 'c1',
    payment: 'cash',
    merchantId: 'm1',
    courierId: 'k1',
    itemsSubtotalIqd: 15000,
    commissionTier: 'featured',
    serviceFeeIqd: 500,
    deliveryFeeIqd: 1000,
    ...over,
  };
}
