import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { DriverError, type LedgerEvent, type MerchantBalanceView, type MoneyRules, type SettlementMode, type SettlementPlan, type SettlementRequestReason } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { DistributedKeyedLock } from '../../shared/db/advisory-lock.js';
import { Accounts, idOf } from './accounts.js';
import type { LedgerEventBus } from './events.adapter.js';
import type { LedgerIncidentPort } from './incidents.js';
import { LedgerService, sumFor } from './ledger.service.js';
import type { MerchantSettings, MerchantSettingsRepository } from './merchant-settings.repository.js';
import { postMerchantPaidByCourier, postSettlement, type SettlementChannel } from './postings.js';
import { settlementReference } from './settlement-ref.js';
import { LEDGER_EVENTS, LEDGER_INCIDENTS, MERCHANT_SETTINGS_REPOSITORY, MONEY_RULES } from './tokens.js';

/** On-demand settlement target (decisions §3: "within the hour"). */
const ON_DEMAND_TARGET_MS = 60 * 60_000;

/** Modes in which couriers bring the merchant its cash (nightly return route, or on demand). */
const COURIER_MODES: ReadonlySet<SettlementMode> = new Set(['nightly_courier', 'on_demand']);

/** The ledger lines one attribution pass reads: restaurants' accounts and their order groups, and couriers' own books. */
export interface CashAttributionInput {
  /** Each restaurant's `merchant_cash:` lines. */
  merchantEvents: ReadonlyMap<string, readonly LedgerEvent[]>;
  /** Every line of the order groups those restaurants were paid in (to find who collected the cash). */
  groupEvents: readonly LedgerEvent[];
  /** Each courier's `cash:` and `driver:` lines (what he holds, what he has earned, what he handed in). */
  courierEvents: ReadonlyMap<string, readonly LedgerEvent[]>;
  /**
   * Where each courier's lines start: the last moment he held no cash (nothing he collected before it
   * can still be in his hand), with his `cash:` and `driver:` balances then. Absent: his whole history.
   * `since: null` means he holds no cash now.
   */
  windows?: ReadonlyMap<string, { since: Date | null; cash: number; pay: number }>;
}

const byTime = (a: LedgerEvent, b: LedgerEvent) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.recordedAt.getTime() - b.recordedAt.getTime() || a.id.localeCompare(b.id);

/**
 * Which couriers hold which restaurant's cash, from the ledger alone, across every restaurant at once.
 * Each cash order a courier collected adds the restaurant's net (payable − commission) to one FIFO queue
 * under that courier; his hand-overs to a restaurant (`merchant_paid_by_courier`) consume his entries
 * for it; a payout by the company (`merchant_payout`) consumes that restaurant's oldest entries of
 * anyone (those couriers now owe the company instead).
 *
 * Cash he hands in to the company (`driver_settlement` on his `cash:`) is applied once, whatever the
 * number of restaurants: what he owes the company (`owedIqd`: the cash in his hand less his pay) is the
 * restaurants' cash he holds plus the company's own part (fees and commission on his cash orders), so
 * a hand-in first pays the company's own part, and only the rest comes off his restaurant cash, oldest
 * first across restaurants: that much is with the company now. Lines are taken in time order, so a
 * hand-in only consumes cash he had already collected. A courier is never shown holding more
 * restaurant cash than he has in hand.
 *
 * Returns, per restaurant, the cash each courier holds for it.
 */
export function attributeCourierCash(input: CashAttributionInput): Map<string, Map<string, number>> {
  const byGroup = new Map<string, LedgerEvent[]>();
  for (const e of input.groupEvents) {
    if (!e.postingGroupId) continue;
    const list = byGroup.get(e.postingGroupId) ?? [];
    list.push(e);
    byGroup.set(e.postingGroupId, list);
  }
  const merchantOf = new Map<string, string>();
  for (const merchantId of input.merchantEvents.keys()) merchantOf.set(Accounts.merchantCash(merchantId), merchantId);
  // One timeline: restaurants' lines, and each courier's own lines (to follow what he owes the company).
  const lines = new Map<string, LedgerEvent>();
  for (const list of input.merchantEvents.values()) for (const e of list) lines.set(e.id, e);
  for (const list of input.courierEvents.values()) for (const e of list) lines.set(e.id, e);
  const timeline = [...lines.values()].sort(byTime);

  type Entry = { merchantId: string; courierId: string; amount: number };
  const queue: Entry[] = [];
  // Each courier's entries (oldest first) and their open total, so his hand-ins don't walk everyone's.
  const mine = new Map<string, Entry[]>();
  const open = new Map<string, number>();
  const take = (entry: Entry, left: number) => {
    const n = Math.min(entry.amount, left);
    entry.amount -= n;
    open.set(entry.courierId, (open.get(entry.courierId) ?? 0) - n);
    return n;
  };
  const consume = (amount: number, match: (q: Entry) => boolean, courierId?: string) => {
    let left = amount;
    for (const entry of courierId ? (mine.get(courierId) ?? []) : queue) {
      if (left <= 0) break;
      if (entry.amount > 0 && match(entry)) left -= take(entry, left);
    }
  };
  const restaurantCash = (courierId: string) => open.get(courierId) ?? 0;
  // Running balances of each courier's `cash:` (negative while he holds cash) and `driver:` (his pay).
  const cashBal = new Map<string, number>();
  const payBal = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, by: number) => m.set(id, (m.get(id) ?? 0) + by);
  for (const [courierId, w] of input.windows ?? []) {
    cashBal.set(courierId, w.cash);
    payBal.set(courierId, w.pay);
  }
  // Cash collected before his window is no longer in his hand.
  const inWindow = (courierId: string, at: Date) => {
    const w = input.windows?.get(courierId);
    if (!w) return true;
    return w.since !== null && at.getTime() >= w.since.getTime();
  };
  const seenGroups = new Set<string>();

  for (const e of timeline) {
    const handIn = e.type === 'driver_settlement' ? idOf(e.toAccount, 'cash') : undefined;
    if (handIn && input.courierEvents.has(handIn)) {
      const owed = Math.max(0, -((cashBal.get(handIn) ?? 0) + (payBal.get(handIn) ?? 0)));
      const companyPart = Math.max(0, owed - restaurantCash(handIn));
      const fromRestaurants = Math.max(0, e.amount - companyPart);
      if (fromRestaurants > 0) consume(fromRestaurants, () => true, handIn);
    }
    // Keep each courier's balances (after the hand-in itself was weighed against them).
    for (const [account, sign] of [[e.toAccount, 1], [e.fromAccount, -1]] as const) {
      const cashOf = idOf(account, 'cash');
      if (cashOf && input.courierEvents.has(cashOf)) bump(cashBal, cashOf, sign * e.amount);
      const payOf = idOf(account, 'driver');
      if (payOf && input.courierEvents.has(payOf)) bump(payBal, payOf, sign * e.amount);
    }
    if (handIn) continue;
    const fromMerchant = merchantOf.get(e.fromAccount);
    if (e.type === 'merchant_paid_by_courier' && fromMerchant) {
      const courierId = idOf(e.toAccount, 'cash');
      if (courierId) consume(e.amount, (q) => q.merchantId === fromMerchant, courierId);
      continue;
    }
    if (e.type === 'merchant_payout' && fromMerchant) {
      consume(e.amount, (q) => q.merchantId === fromMerchant);
      continue;
    }
    const toMerchant = merchantOf.get(e.toAccount);
    if (e.type !== 'merchant_payable' || !toMerchant || !e.postingGroupId || seenGroups.has(`${e.postingGroupId}:${toMerchant}`)) continue;
    seenGroups.add(`${e.postingGroupId}:${toMerchant}`);
    const group = byGroup.get(e.postingGroupId) ?? [];
    const collector = group.find((l) => l.type === 'cash_collected')?.fromAccount;
    const courierId = collector ? idOf(collector, 'cash') : undefined;
    if (!courierId || !inWindow(courierId, e.occurredAt)) continue;
    let net = 0;
    for (const l of group) {
      if (l.toAccount === e.toAccount) net += l.amount;
      if (l.fromAccount === e.toAccount) net -= l.amount;
    }
    if (net > 0) {
      const entry = { merchantId: toMerchant, courierId, amount: net };
      queue.push(entry);
      const list = mine.get(courierId);
      if (list) list.push(entry);
      else mine.set(courierId, [entry]);
      open.set(courierId, (open.get(courierId) ?? 0) + net);
    }
  }

  // Never more restaurant cash than he has in hand: his newest entries give way first.
  for (const [courierId, list] of mine) {
    if (!input.courierEvents.has(courierId)) continue;
    let over = restaurantCash(courierId) - Math.max(0, -(cashBal.get(courierId) ?? 0));
    for (let i = list.length - 1; i >= 0 && over > 0; i--) over -= take(list[i]!, over);
  }
  const out = new Map<string, Map<string, number>>();
  for (const { merchantId, courierId, amount } of queue) {
    if (amount <= 0) continue;
    const m = out.get(merchantId) ?? new Map<string, number>();
    m.set(courierId, (m.get(courierId) ?? 0) + amount);
    out.set(merchantId, m);
  }
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
  /**
   * One movement of a merchant's cash at a time — settlement requests, courier hand-overs, company
   * payouts — in process and across API instances (advisory lock in the transaction; review #22), so
   * every "how much is owed" check sees the movement before it.
   */
  private readonly merchantLock: DistributedKeyedLock;
  /** One payout to a driver at a time (same as the merchant lock, keyed by the driver). */
  private readonly driverLock: DistributedKeyedLock;

  constructor(
    private readonly ledger: LedgerService,
    @Inject(MERCHANT_SETTINGS_REPOSITORY) private readonly settingsRepo: MerchantSettingsRepository,
    @Inject(LEDGER_EVENTS) private readonly bus: LedgerEventBus,
    @Inject(LEDGER_INCIDENTS) private readonly incidents: LedgerIncidentPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    @Optional() @Inject(UnitOfWork) private readonly uow?: UnitOfWork,
  ) {
    this.merchantLock = new DistributedKeyedLock(uow, 'ledger.merchant_cash');
    this.driverLock = new DistributedKeyedLock(uow, 'ledger.driver_payout');
  }

  private run<T>(fn: (tx: Tx | undefined) => Promise<T>): Promise<T> {
    return this.uow ? this.uow.run((tx) => fn(tx)) : fn(undefined);
  }

  /** Inside the lock's transaction when there is one, else a unit of work of its own. */
  private inTx<T>(held: Tx | undefined, fn: (tx: Tx | undefined) => Promise<T>): Promise<T> {
    return held ? fn(held) : this.run(fn);
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
    return (await this.holdersOf([merchantId])).get(merchantId) ?? [];
  }

  /**
   * Holders of several restaurants in one pass. A courier's hand-in to the company is weighed once
   * against all the restaurant cash he holds, so the pass reads every restaurant those couriers
   * collected for, not only the ones asked about.
   */
  private async holdersOf(merchantIds: readonly string[]): Promise<Map<string, Array<{ courierId: string; amountIqd: number }>>> {
    const merchantEvents = new Map<string, LedgerEvent[]>();
    const groupIds = new Set<string>();
    for (const id of merchantIds) {
      if (merchantEvents.has(id)) continue;
      const events = await this.ledger.eventsFor(Accounts.merchantCash(id));
      merchantEvents.set(id, events);
      for (const e of events) if (e.type === 'merchant_payable' && e.postingGroupId) groupIds.add(e.postingGroupId);
    }
    const asked = await this.ledger.eventsForGroups([...groupIds]);
    // Each collecting courier's own book since he last held no cash: what he holds, his pay, his hand-ins.
    const couriers = [...new Set(asked.filter((l) => l.type === 'cash_collected').map((l) => idOf(l.fromAccount, 'cash')).filter((c): c is string => Boolean(c)))];
    const courierEvents = new Map<string, LedgerEvent[]>();
    const windows = new Map<string, { since: Date | null; cash: number; pay: number }>();
    const courierGroups = new Set<string>();
    for (const c of couriers) {
      const w = await this.cashWindow(c);
      windows.set(c, { since: w.since, cash: w.cash, pay: w.pay });
      courierEvents.set(c, [...w.cashLines, ...w.payLines]);
      for (const e of w.cashLines) if (e.type === 'cash_collected' && e.postingGroupId && !groupIds.has(e.postingGroupId)) courierGroups.add(e.postingGroupId);
    }
    // The other restaurants those couriers collected for in their windows: their entries come from the
    // couriers' own order groups, their hand-overs from the couriers' own lines.
    const others = courierGroups.size ? await this.ledger.eventsForGroups([...courierGroups]) : [];
    for (const l of others) {
      const m = l.type === 'merchant_payable' ? idOf(l.toAccount, 'merchant_cash') : undefined;
      if (!m || merchantIds.includes(m)) continue;
      merchantEvents.set(m, [...(merchantEvents.get(m) ?? []), l]);
    }
    const groupEvents = others.length ? [...asked, ...others] : asked;
    const attributed = attributeCourierCash({ merchantEvents, groupEvents, courierEvents, windows });
    const out = new Map<string, Array<{ courierId: string; amountIqd: number }>>();
    for (const merchantId of merchantIds) {
      // Refunds or commission on wallet orders can leave the merchant owed less than couriers hold for it.
      let room = Math.max(0, sumFor(Accounts.merchantCash(merchantId), merchantEvents.get(merchantId) ?? []));
      out.set(
        merchantId,
        [...(attributed.get(merchantId) ?? new Map<string, number>()).entries()]
          .map(([courierId, amountIqd]) => ({ courierId, amountIqd }))
          .sort((a, b) => b.amountIqd - a.amountIqd || a.courierId.localeCompare(b.courierId))
          .map((h) => {
            const amountIqd = Math.min(h.amountIqd, room);
            room -= amountIqd;
            return { ...h, amountIqd };
          })
          .filter((h) => h.amountIqd > 0),
      );
    }
    return out;
  }

  /**
   * A courier's lines since he last held no cash, read newest first a page at a time (he settles
   * nightly, so this is a day or two, not his whole history), with his `cash:` and `driver:` balances
   * at that moment. `since: null`: he holds no cash now.
   */
  private async cashWindow(courierId: string): Promise<{ since: Date | null; cash: number; pay: number; cashLines: LedgerEvent[]; payLines: LedgerEvent[] }> {
    const account = Accounts.cash(courierId);
    let running = (await this.ledger.balance(account)).amount;
    if (running >= 0) return { since: null, cash: running, pay: 0, cashLines: [], payLines: [] };
    const lines: LedgerEvent[] = [];
    let before: Date | undefined;
    let since: Date | undefined;
    while (since === undefined) {
      const page = await this.ledger.eventsPage(account, { before, take: 200 });
      // Newest first, a timestamp at a time (a posting group's lines share one).
      const stamps = [...new Set(page.events.map((e) => e.occurredAt.getTime()))].sort((a, b) => b - a);
      for (const t of stamps) {
        const at = page.events.filter((e) => e.occurredAt.getTime() === t);
        lines.push(...at);
        for (const e of at) running -= (e.toAccount === account ? e.amount : 0) - (e.fromAccount === account ? e.amount : 0);
        if (running >= 0) {
          since = new Date(t);
          break;
        }
      }
      if (since !== undefined) break;
      if (page.complete || page.events.length === 0) break;
      before = new Date(Math.min(...stamps));
    }
    if (since === undefined) {
      // Never held nothing since his first line: his whole history counts.
      const payLines = await this.ledger.eventsFor(Accounts.driver(courierId));
      return { since: new Date(0), cash: 0, pay: 0, cashLines: lines.sort(byTime), payLines };
    }
    const [payLines, pay] = await Promise.all([this.ledger.eventsSince(Accounts.driver(courierId), since), this.ledger.balance(Accounts.driver(courierId), since)]);
    return { since, cash: running, pay: pay.amount, cashLines: lines.sort(byTime), payLines };
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

  /**
   * "اطلب فلوسك": records the request and emits `merchant.settlement_requested`; returns the plan.
   * Pressing it again while the last request is still open (nothing settled since, inside its one-hour
   * target) answers with that same request — same reference and target, no second routing — so a
   * double tap or two phones never send two couriers or two payouts for the same money.
   */
  requestSettlement(merchantId: string, requestedBy: string, reason: SettlementRequestReason = 'merchant_request'): Promise<SettlementPlan> {
    return this.merchantLock.run(merchantId, (tx) => this.requestSettlementNow(merchantId, requestedBy, reason, tx));
  }

  private async requestSettlementNow(merchantId: string, requestedBy: string, reason: SettlementRequestReason, held: Tx | undefined): Promise<SettlementPlan> {
    const view = await this.balance(merchantId);
    if (view.balanceIqd <= 0) throw new DriverError('settlement_nothing_due');
    const now = this.clock.now();
    const open = view.lastRequestedAt && (!view.lastSettledAt || view.lastRequestedAt > view.lastSettledAt) && now.getTime() - view.lastRequestedAt.getTime() < ON_DEMAND_TARGET_MS;
    if (open) return this.plan(view, reason, view.lastRequestedAt!);
    const at = now;
    const plan = this.plan(view, reason, at);
    await this.inTx(held, async (tx) => {
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
    // The "how much does he still owe" check and the posting run under the merchant's lock, so two
    // hand-overs of the same cash at once post once (backend review #21/#22). The incident for a
    // mismatch is opened after the lock's transaction, so refusing never rolls it back.
    const out = await this.merchantLock.run(input.merchantId, async (held) => {
      const s = await this.settings(input.merchantId);
      // The merchant confirms with its PIN, or by a tap on its own signed-in tablet. A merchant with no
      // PIN set confirms only by the tap: no typed PIN can stand in for one it never chose.
      const pinOk = input.pin ? Boolean(s.pinHash) && hashPin(input.merchantId, input.pin) === s.pinHash : Boolean(input.tabletTap);
      const owed = (await this.holders(input.merchantId)).find((h) => h.courierId === input.courierId)?.amountIqd ?? 0;
      const problem = !pinOk ? 'pin' : input.amountIqd !== input.merchantConfirmedIqd ? 'amount_disagreement' : input.amountIqd > owed ? 'more_than_owed' : input.amountIqd <= 0 ? 'zero' : null;
      if (problem) return { ok: false as const, problem, owed };
      return { ok: true as const, posted: await this.postHandover(input, s, held) };
    });
    if (out.ok) return out.posted;
    await this.incidents.open({
      kind: 'merchant_handover_discrepancy',
      summary: `hand-over ${input.handoverId}: ${out.problem}`,
      evidence: { ...input, pin: undefined, owedIqd: out.owed, problem: out.problem },
    });
    throw new DriverError('handover_mismatch');
  }

  private postHandover(input: HandoverInput, s: MerchantSettings, held: Tx | undefined): Promise<{ postedIqd: number; merchantBalanceIqd: number }> {
    const at = this.clock.now();
    return this.inTx(held, async (tx) => {
      // Ledger reads are not transaction-scoped: take the balance before posting (under the lock).
      const before = (await this.ledger.balance(Accounts.merchantCash(input.merchantId))).amount;
      const posted = await this.ledger.recordAll(postMerchantPaidByCourier({ ...input, occurredAt: at }), tx);
      const balance = posted.recorded.length > 0 ? before - input.amountIqd : before;
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

  /**
   * Company → merchant payout (ZainCash, ops round, bank) under a settlement reference. Never more
   * than the merchant is owed right now (`payout_exceeds_balance`, backend review 2026-10-04 #21);
   * partial payouts are fine. Checked and posted under the merchant's lock, so two payouts at once
   * cannot together overpay. A retry of a reference already posted returns the balance.
   */
  async recordPayout(input: { merchantId: string; amountIqd: number; channel: SettlementChannel; reference: string }): Promise<number> {
    if (input.amountIqd <= 0) throw new DriverError('settlement_nothing_due');
    const at = this.clock.now();
    const group = postSettlement({ kind: 'merchant_payout', ...input, occurredAt: at });
    return this.merchantLock.run(input.merchantId, (held) =>
      this.inTx(held, async (tx) => {
        const account = Accounts.merchantCash(input.merchantId);
        if ((await this.ledger.eventsForGroups([group.id])).length > 0) return (await this.ledger.balance(account)).amount;
        const before = (await this.ledger.balance(account)).amount;
        if (input.amountIqd > before) throw new DriverError('payout_exceeds_balance');
        await this.ledger.recordAll(group, tx);
        const balance = before - input.amountIqd;
        if (balance <= 0) await this.settingsRepo.upsert({ ...(await this.settings(input.merchantId)), lastSettledAt: at }, tx);
        return balance;
      }),
    );
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
   * Company → driver payout (G-86): what the platform owes him beyond the cash he holds, paid by
   * ZainCash, at an agent, by the ops round or bank, under a settlement reference. Never more than it
   * owes him right now (`payout_exceeds_due`); checked and posted under his lock, so two payouts at
   * once cannot overpay. A retry of a reference already posted posts nothing. Returns what the
   * platform still owes him after.
   */
  async recordDriverPayout(input: { driverId: string; amountIqd: number; channel: SettlementChannel; reference: string }): Promise<number> {
    if (input.amountIqd <= 0) throw new DriverError('settlement_nothing_due');
    const at = this.clock.now();
    const group = postSettlement({ kind: 'driver_payout', ...input, occurredAt: at });
    const due = async () => {
      const [earnings, cash] = await Promise.all([this.ledger.balance(Accounts.driver(input.driverId)), this.ledger.balance(Accounts.cash(input.driverId))]);
      return earnings.amount + cash.amount;
    };
    return this.driverLock.run(input.driverId, (held) =>
      this.inTx(held, async (tx) => {
        if ((await this.ledger.eventsForGroups([group.id])).length > 0) return Math.max(0, await due());
        const before = await due();
        if (input.amountIqd > before) throw new DriverError('payout_exceeds_due');
        await this.ledger.recordAll(group, tx);
        return before - input.amountIqd;
      }),
    );
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
    const holders = await this.holdersOf(merchants);
    for (const merchantId of merchants) {
      const s = await this.settings(merchantId);
      if (!COURIER_MODES.has(s.mode)) continue;
      const owed = holders.get(merchantId)?.find((h) => h.courierId === courierId)?.amountIqd ?? 0;
      if (owed > 0) stops.push({ merchantId, amountIqd: owed, mode: s.mode });
    }
    return stops.sort((a, b) => b.amountIqd - a.amountIqd || a.merchantId.localeCompare(b.merchantId));
  }
}
