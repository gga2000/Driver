import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DriverError, type LedgerEvent, type MerchantBalanceView, type MoneyRules, type SettlementMode, type SettlementPlan, type SettlementRequestReason } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { Accounts, idOf } from './accounts.js';
import type { LedgerEventBus } from './events.adapter.js';
import type { LedgerIncidentPort } from './incidents.js';
import { LedgerService } from './ledger.service.js';
import type { MerchantSettings, MerchantSettingsRepository } from './merchant-settings.repository.js';
import { postMerchantPaidByCourier, postSettlement, type SettlementChannel } from './postings.js';
import { settlementReference } from './settlement-ref.js';
import { LEDGER_EVENTS, LEDGER_INCIDENTS, MERCHANT_SETTINGS_REPOSITORY, MONEY_RULES } from './tokens.js';

/** On-demand settlement target (decisions §3: "within the hour"). */
const ON_DEMAND_TARGET_MS = 60 * 60_000;

/** Modes in which couriers bring the merchant its cash (nightly return route, or on demand). */
const COURIER_MODES: ReadonlySet<SettlementMode> = new Set(['nightly_courier', 'on_demand']);

/**
 * Which couriers hold a merchant's cash, from the ledger alone. Each cash order a courier collected
 * adds the merchant's net (payable − commission) to a FIFO queue under that courier; his hand-overs
 * (`merchant_paid_by_courier`) consume his own entries; a payout by the company (`merchant_payout`)
 * consumes the oldest entries of anyone — those couriers now owe the platform instead.
 */
export function attributeMerchantCash(merchantAccount: string, merchantEvents: readonly LedgerEvent[], groupEvents: readonly LedgerEvent[]): Map<string, number> {
  const byGroup = new Map<string, LedgerEvent[]>();
  for (const e of groupEvents) {
    if (!e.postingGroupId) continue;
    const list = byGroup.get(e.postingGroupId) ?? [];
    list.push(e);
    byGroup.set(e.postingGroupId, list);
  }
  const queue: Array<{ courierId: string; amount: number }> = [];
  const consume = (amount: number, courierId?: string) => {
    let left = amount;
    for (const entry of queue) {
      if (left <= 0) break;
      if (courierId && entry.courierId !== courierId) continue;
      const take = Math.min(entry.amount, left);
      entry.amount -= take;
      left -= take;
    }
  };
  const seenGroups = new Set<string>();
  for (const e of merchantEvents) {
    if (e.type === 'merchant_paid_by_courier' && e.fromAccount === merchantAccount) {
      const courierId = idOf(e.toAccount, 'cash');
      if (courierId) consume(e.amount, courierId);
      continue;
    }
    if (e.type === 'merchant_payout' && e.fromAccount === merchantAccount) {
      consume(e.amount);
      continue;
    }
    if (e.type !== 'merchant_payable' || !e.postingGroupId || seenGroups.has(e.postingGroupId)) continue;
    seenGroups.add(e.postingGroupId);
    const lines = byGroup.get(e.postingGroupId) ?? [];
    const collector = lines.find((l) => l.type === 'cash_collected')?.fromAccount;
    const courierId = collector ? idOf(collector, 'cash') : undefined;
    if (!courierId) continue;
    let net = 0;
    for (const l of lines) {
      if (l.toAccount === merchantAccount) net += l.amount;
      if (l.fromAccount === merchantAccount) net -= l.amount;
    }
    if (net > 0) queue.push({ courierId, amount: net });
  }
  const out = new Map<string, number>();
  for (const { courierId, amount } of queue) if (amount > 0) out.set(courierId, (out.get(courierId) ?? 0) + amount);
  return out;
}

export function hashPin(merchantId: string, pin: string): string {
  return createHash('sha256').update(`${merchantId}:${pin}`).digest('hex');
}

export interface HandoverInput {
  handoverId: string;
  courierId: string;
  merchantId: string;
  /** What the courier says he handed over. */
  amountIqd: number;
  /** What the merchant confirms receiving (both confirmations, decisions §3). */
  merchantConfirmedIqd: number;
  pin?: string;
  tabletTap?: boolean;
}

/**
 * Merchant cash account (decisions §3): live balance, settlement modes, exposure-cap auto
 * trigger, "اطلب فلوسك" requests, PIN-confirmed courier hand-overs and the courier return route.
 */
@Injectable()
export class MerchantCashService {
  constructor(
    private readonly ledger: LedgerService,
    @Inject(MERCHANT_SETTINGS_REPOSITORY) private readonly settingsRepo: MerchantSettingsRepository,
    @Inject(LEDGER_EVENTS) private readonly bus: LedgerEventBus,
    @Inject(LEDGER_INCIDENTS) private readonly incidents: LedgerIncidentPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    @Optional() @Inject(UnitOfWork) private readonly uow?: UnitOfWork,
  ) {}

  private run<T>(fn: (tx: Tx | undefined) => Promise<T>): Promise<T> {
    return this.uow ? this.uow.run((tx) => fn(tx)) : fn(undefined);
  }

  async settings(merchantId: string): Promise<MerchantSettings> {
    return (
      (await this.settingsRepo.find(merchantId)) ?? {
        merchantId,
        mode: this.rules.merchant.defaultMode,
        exposureCapIqd: this.rules.merchant.exposureCapIqd,
        pinHash: null,
        lastSettledAt: null,
        lastRequestedAt: null,
      }
    );
  }

  async configure(merchantId: string, patch: { mode?: SettlementMode; exposureCapIqd?: number; pin?: string }): Promise<MerchantSettings> {
    const s = await this.settings(merchantId);
    return this.settingsRepo.upsert({
      ...s,
      ...(patch.mode ? { mode: patch.mode } : {}),
      ...(patch.exposureCapIqd ? { exposureCapIqd: patch.exposureCapIqd } : {}),
      ...(patch.pin ? { pinHash: hashPin(merchantId, patch.pin) } : {}),
    });
  }

  /** Couriers holding this merchant's cash right now, largest first. */
  async holders(merchantId: string): Promise<Array<{ courierId: string; amountIqd: number }>> {
    const account = Accounts.merchantCash(merchantId);
    const events = await this.ledger.eventsFor(account);
    const groupIds = [...new Set(events.filter((e) => e.type === 'merchant_payable' && e.postingGroupId).map((e) => e.postingGroupId!))];
    const groups = await this.ledger.eventsForGroups(groupIds);
    const attributed = attributeMerchantCash(account, events, groups);
    // Refunds or commission on wallet orders can leave the merchant owed less than couriers hold for it.
    let room = Math.max(0, (await this.ledger.balance(account)).amount);
    return [...attributed.entries()]
      .map(([courierId, amountIqd]) => ({ courierId, amountIqd }))
      .sort((a, b) => b.amountIqd - a.amountIqd || a.courierId.localeCompare(b.courierId))
      .map((h) => {
        const amountIqd = Math.min(h.amountIqd, room);
        room -= amountIqd;
        return { ...h, amountIqd };
      })
      .filter((h) => h.amountIqd > 0);
  }

  /** Live balance for the Merchant app and Console. */
  async balance(merchantId: string): Promise<MerchantBalanceView> {
    const [s, bal, holders] = await Promise.all([this.settings(merchantId), this.ledger.balance(Accounts.merchantCash(merchantId)), this.holders(merchantId)]);
    return {
      merchantId,
      balanceIqd: bal.amount,
      mode: s.mode,
      exposureCapIqd: s.exposureCapIqd,
      overExposure: bal.amount >= s.exposureCapIqd,
      holders,
      lastSettledAt: s.lastSettledAt,
      lastRequestedAt: s.lastRequestedAt,
    };
  }

  /** How the money should reach the merchant: the courier holding most of it, else the mode's channel. */
  plan(view: MerchantBalanceView, reason: SettlementRequestReason, at: Date): SettlementPlan {
    const top = view.holders[0];
    const reference = settlementReference('M', view.merchantId, at, at.getTime());
    const targetBy = new Date(at.getTime() + ON_DEMAND_TARGET_MS);
    if (top && COURIER_MODES.has(view.mode)) {
      return { merchantId: view.merchantId, amountIqd: Math.min(top.amountIqd, view.balanceIqd), channel: 'courier', courierId: top.courierId, reference, targetBy, reason };
    }
    const channel = view.mode === 'daily_zaincash' ? 'zaincash' : view.mode === 'weekly_bulk' ? 'bank' : 'ops_round';
    return { merchantId: view.merchantId, amountIqd: view.balanceIqd, channel, reference, targetBy, reason };
  }

  /** "اطلب فلوسك": records the request and emits `merchant.settlement_requested`; returns the plan. */
  async requestSettlement(merchantId: string, requestedBy: string, reason: SettlementRequestReason = 'merchant_request'): Promise<SettlementPlan> {
    const view = await this.balance(merchantId);
    if (view.balanceIqd <= 0) throw new DriverError('settlement_nothing_due');
    const at = this.clock.now();
    const plan = this.plan(view, reason, at);
    await this.run(async (tx) => {
      const s = await this.settings(merchantId);
      await this.settingsRepo.upsert({ ...s, lastRequestedAt: at }, tx);
      await this.bus.emit(
        tx,
        {
          actorId: requestedBy,
          type: 'merchant.settlement_requested',
          occurredAt: at,
          payload: { merchantId, occurredAt: at.toISOString(), reason, requestedBy, balanceIqd: view.balanceIqd, reference: plan.reference },
          idempotencyKey: `merchant.settlement_requested:${plan.reference}`,
        },
        { name: 'merchant', id: merchantId },
      );
    });
    return plan;
  }

  /** Subscriber side of a request: route it (courier holding the cash, or ops/ZainCash) and announce the assignment. */
  async assign(merchantId: string, reason: SettlementRequestReason, reference?: string): Promise<SettlementPlan | null> {
    const view = await this.balance(merchantId);
    if (view.balanceIqd <= 0) return null;
    const planned = this.plan(view, reason, this.clock.now());
    // Keep the request's own reference so the request and its assignment read as one (Merchant app timeline).
    const plan = reference ? { ...planned, reference } : planned;
    await this.run((tx) =>
      this.bus.emit(
        tx,
        {
          actorId: 'system:ledger',
          type: 'merchant.settlement_assigned',
          occurredAt: this.clock.now(),
          payload: { ...plan, targetBy: plan.targetBy.toISOString() },
          idempotencyKey: `merchant.settlement_assigned:${plan.reference}`,
        },
        { name: 'merchant', id: merchantId },
      ),
    );
    return plan;
  }

  /** Exposure cap reached and no request open since the last settlement → request automatically. */
  async checkExposure(merchantId: string): Promise<SettlementPlan | null> {
    const view = await this.balance(merchantId);
    if (!view.overExposure) return null;
    const open = view.lastRequestedAt && (!view.lastSettledAt || view.lastRequestedAt > view.lastSettledAt);
    if (open) return null;
    return this.requestSettlement(merchantId, 'system:ledger', 'exposure_cap');
  }

  /**
   * Courier → merchant cash hand-over, confirmed by PIN (or tablet tap) and by both amounts.
   * Any mismatch opens an incident and posts nothing.
   */
  async confirmHandover(input: HandoverInput): Promise<{ postedIqd: number; merchantBalanceIqd: number }> {
    const s = await this.settings(input.merchantId);
    const pinOk = s.pinHash ? Boolean(input.pin) && hashPin(input.merchantId, input.pin!) === s.pinHash : Boolean(input.tabletTap) || Boolean(input.pin);
    const owed = (await this.holders(input.merchantId)).find((h) => h.courierId === input.courierId)?.amountIqd ?? 0;
    const problem = !pinOk ? 'pin' : input.amountIqd !== input.merchantConfirmedIqd ? 'amount_disagreement' : input.amountIqd > owed ? 'more_than_owed' : input.amountIqd <= 0 ? 'zero' : null;
    if (problem) {
      await this.incidents.open({
        kind: 'merchant_handover_discrepancy',
        summary: `hand-over ${input.handoverId}: ${problem}`,
        evidence: { ...input, pin: undefined, owedIqd: owed, problem },
      });
      throw new DriverError('handover_mismatch');
    }
    const at = this.clock.now();
    return this.run(async (tx) => {
      await this.ledger.recordAll(postMerchantPaidByCourier({ ...input, occurredAt: at }), tx);
      const balance = (await this.ledger.balance(Accounts.merchantCash(input.merchantId))).amount;
      if (balance <= 0) await this.settingsRepo.upsert({ ...s, lastSettledAt: at }, tx);
      await this.bus.emit(
        tx,
        {
          actorId: input.courierId,
          type: 'merchant.paid_by_courier',
          occurredAt: at,
          payload: {
            handoverId: input.handoverId,
            merchantId: input.merchantId,
            courierId: input.courierId,
            amountIqd: input.amountIqd,
            merchantBalanceIqd: balance,
            confirmedBy: input.pin ? 'pin' : 'tablet',
          },
          idempotencyKey: `merchant.paid_by_courier:${input.handoverId}`,
        },
        { name: 'merchant', id: input.merchantId },
      );
      return { postedIqd: input.amountIqd, merchantBalanceIqd: balance };
    });
  }

  /** Company → merchant payout (ZainCash, ops round, bank) under a settlement reference. */
  async recordPayout(input: { merchantId: string; amountIqd: number; channel: SettlementChannel; reference: string }): Promise<number> {
    const at = this.clock.now();
    return this.run(async (tx) => {
      await this.ledger.recordAll(postSettlement({ kind: 'merchant_payout', ...input, occurredAt: at }), tx);
      const balance = (await this.ledger.balance(Accounts.merchantCash(input.merchantId))).amount;
      if (balance <= 0) await this.settingsRepo.upsert({ ...(await this.settings(input.merchantId)), lastSettledAt: at }, tx);
      return balance;
    });
  }

  /**
   * Courier or driver → company: cash handed in at an agent, by ZainCash or to the ops round
   * (adopted "daytime agent collection"), under a settlement reference. Lowers what he owes, so his
   * cap frees up; returns his `cash:` balance after.
   */
  async recordDriverSettlement(input: { driverId: string; amountIqd: number; channel: SettlementChannel; reference: string }): Promise<number> {
    if (input.amountIqd <= 0) throw new DriverError('settlement_nothing_due');
    const at = this.clock.now();
    return this.run(async (tx) => {
      await this.ledger.recordAll(postSettlement({ kind: 'driver_settlement', ...input, occurredAt: at }), tx);
      return (await this.ledger.balance(Accounts.cash(input.driverId))).amount;
    });
  }

  /**
   * Courier return route (decisions §3): the merchants in a courier-settled mode he owes cash to
   * tonight and how much each; Partner orders the stops geographically.
   */
  async returnRoute(courierId: string): Promise<Array<{ merchantId: string; amountIqd: number; mode: SettlementMode }>> {
    const cash = await this.ledger.eventsFor(Accounts.cash(courierId));
    const groupIds = [...new Set(cash.filter((e) => e.type === 'cash_collected' && e.postingGroupId).map((e) => e.postingGroupId!))];
    const lines = await this.ledger.eventsForGroups(groupIds);
    const merchants = [...new Set(lines.filter((l) => l.type === 'merchant_payable').map((l) => idOf(l.toAccount, 'merchant_cash')).filter((m): m is string => Boolean(m)))];
    const stops: Array<{ merchantId: string; amountIqd: number; mode: SettlementMode }> = [];
    for (const merchantId of merchants) {
      const s = await this.settings(merchantId);
      if (!COURIER_MODES.has(s.mode)) continue;
      const owed = (await this.holders(merchantId)).find((h) => h.courierId === courierId)?.amountIqd ?? 0;
      if (owed > 0) stops.push({ merchantId, amountIqd: owed, mode: s.mode });
    }
    return stops.sort((a, b) => b.amountIqd - a.amountIqd || a.merchantId.localeCompare(b.merchantId));
  }
}
