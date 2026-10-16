import { AZIZIYAH_MONEY_RULES, type MoneyRules, type OrderMoneyPayload } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { AdjustmentService } from './adjustments.service.js';
import { CashCapWatch } from './cap-watch.js';
import { CapsService, StaticCapProfiles } from './caps.js';
import { RecordingLedgerBus } from './events.adapter.js';
import { ShiftGuaranteeService, type ShiftActivity, type ShiftActivitySource } from './guarantee.js';
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
/** Shift activity scripted per driver (G-91 tests): what `EventsShiftActivity` would read from the log. */
export class ScriptedShiftActivity implements ShiftActivitySource {
  readonly byDriver = new Map<string, ShiftActivity>();

  of(driverId: string): ShiftActivity {
    const known = this.byDriver.get(driverId);
    if (known) return known;
    const fresh: ShiftActivity = { offers: [], cancelsAfterAccept: [], completed: [] };
    this.byDriver.set(driverId, fresh);
    return fresh;
  }

  async activity(driverId: string, range: { from: Date; to: Date }): Promise<ShiftActivity> {
    const a = this.of(driverId);
    const inRange = (x: { at: Date }) => x.at.getTime() >= range.from.getTime() && x.at.getTime() < range.to.getTime();
    return { offers: a.offers.filter(inRange), cancelsAfterAccept: a.cancelsAfterAccept.filter(inRange), completed: a.completed.filter(inRange) };
  }
}

export function ledgerHarness(opts: { start?: string; rules?: MoneyRules; repo?: LedgerRepository; activity?: ShiftActivitySource; clock?: FakeClock } = {}) {
  const clock = opts.clock ?? new FakeClock(opts.start ?? '2026-10-03T12:00:00Z');
  const rules = opts.rules ?? AZIZIYAH_MONEY_RULES;
  const repo = opts.repo ?? new InMemoryLedgerRepository();
  const bus = new RecordingLedgerBus();
  const incidents = new LedgerIncidents(bus, clock);
  const profiles = new StaticCapProfiles();
  const ledger = new LedgerService(repo);
  ledger.watchCaps(new CashCapWatch(profiles, rules, bus));
  const caps = new CapsService(ledger, rules, profiles);
  const settings = new InMemoryMerchantSettingsRepository();
  const merchantCash = new MerchantCashService(ledger, settings, bus, incidents, clock, rules);
  const posting = new PostingService(ledger, merchantCash, rules);
  const adjustments = new AdjustmentService(ledger, incidents, clock, rules);
  const activity = opts.activity ?? new ScriptedShiftActivity();
  const guarantee = new ShiftGuaranteeService(ledger, caps, activity, clock, rules);
  const nightly = new NightlyJob(ledger, caps, incidents, bus, clock, rules, guarantee);
  const facade = new LedgerFacade(ledger, caps, merchantCash, nightly, guarantee);
  registerLedgerSubscribers(bus, posting, merchantCash);
  return { clock, rules, repo, bus, incidents, profiles, ledger, caps, settings, merchantCash, posting, adjustments, activity, guarantee, nightly, facade };
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
