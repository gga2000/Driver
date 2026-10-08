import { Inject, Injectable, Optional } from '@nestjs/common';
import { AccountId, isPointsAccount, kindOf, ledgerLineLabel, type LedgerEvent, type LedgerKind, type Statement, type StatementLine } from '@driver/contracts';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { Accounts } from './accounts.js';
import type { CashCapWatch } from './cap-watch.js';
import type { DriverPosition } from './caps.js';
import type { PostingGroup } from './postings.js';
import type { LedgerRepository, NewLedgerEvent } from './repository.js';
import { LEDGER_REPOSITORY } from './tokens.js';

export { Accounts } from './accounts.js';

export interface Balance {
  accountId: string;
  /** Sum of inflows minus outflows, in IQD (or points on points accounts). */
  amount: number;
  events: number;
}

export interface BookCheck {
  ok: boolean;
  /** Σ(inflows) − Σ(outflows) over this book's accounts; must be exactly 0. */
  net: number;
  events: number;
}

export interface Invariant {
  /** Both books balance and no row crosses books. */
  ok: boolean;
  /** Money-book net, kept for M1 callers. */
  net: number;
  events: number;
  money: BookCheck;
  points: BookCheck;
  /** Rows whose kind disagrees with their type or their accounts. */
  kindViolations: number;
}

export interface RecordAllResult {
  recorded: string[];
  /** Groups already in the ledger (replayed facts): nothing was written for them. */
  skipped: string[];
  events: LedgerEvent[];
}

@Injectable()
export class LedgerService {
  private capWatch: CashCapWatch | null = null;

  constructor(
    @Inject(LEDGER_REPOSITORY) private readonly repo: LedgerRepository,
    @Optional() @Inject(UnitOfWork) private readonly uow?: UnitOfWork,
  ) {}

  /** Cash-cap crossings (`courier.cash_over_cap` / `_under_cap`) are emitted from every posting once this is set (module boot). */
  watchCaps(watch: CashCapWatch | null): void {
    this.capWatch = watch;
  }

  /** Append one event. Amount must be positive; direction is from → to. Prefer `recordAll` for business facts. */
  async record(event: Omit<NewLedgerEvent, 'currency'> & { currency?: 'IQD' }, tx?: Tx): Promise<LedgerEvent> {
    const kind = validateLine(event);
    return this.repo.append({ ...event, kind, currency: 'IQD' }, tx);
  }

  /**
   * Records balanced posting groups atomically: every line and every control total of every group
   * is validated first, and one failure writes nothing. A group already recorded (same id) is
   * skipped, so replays of a domain event are no-ops. Runs inside the caller's unit of work.
   */
  async recordAll(groups: PostingGroup | readonly PostingGroup[], tx?: Tx): Promise<RecordAllResult> {
    const list = (Array.isArray(groups) ? groups : [groups]) as readonly PostingGroup[];
    const ids = new Set<string>();
    for (const g of list) {
      if (ids.has(g.id)) throw new LedgerError('unbalanced', `posting group ${g.id} appears twice in one batch`);
      ids.add(g.id);
      validateGroup(g);
    }
    const write = async (t?: Tx): Promise<RecordAllResult> => {
      const fresh: PostingGroup[] = [];
      const skipped: string[] = [];
      for (const g of list) {
        if (await this.repo.findByIdempotencyKey(lineKey(g.id, 0), t)) skipped.push(g.id);
        else fresh.push(g);
      }
      const rows: NewLedgerEvent[] = fresh.flatMap((g) =>
        g.lines.map((l, i) => ({
          ...g.refs,
          type: l.type,
          kind: g.kind,
          amount: l.amount,
          currency: 'IQD' as const,
          fromAccount: l.fromAccount,
          toAccount: l.toAccount,
          postingGroupId: g.id,
          idempotencyKey: lineKey(g.id, i),
          occurredAt: g.occurredAt,
          ...(l.memo ? { memo: l.memo } : {}),
        })),
      );
      const watch = this.capWatch && rows.length > 0 ? this.capWatch : null;
      const before = watch ? await this.positions(watch.driversIn(rows), t) : null;
      const events = rows.length > 0 ? await this.repo.appendMany(rows, t) : [];
      if (watch && before && before.size > 0) await watch.afterPosting(rows, before, fresh[0]!.id, t);
      return { recorded: fresh.map((g) => g.id), skipped, events };
    };
    if (tx || !this.uow) return write(tx);
    return this.uow.run((t) => write(t));
  }

  /** Drivers' cap positions read inside `tx`, so earlier postings of the same transaction count. */
  private async positions(driverIds: readonly string[], tx?: Tx): Promise<Map<string, DriverPosition>> {
    const out = new Map<string, DriverPosition>();
    for (const id of driverIds) {
      const [earnings, cash] = await Promise.all([this.repo.byAccount(Accounts.driver(id), tx), this.repo.byAccount(Accounts.cash(id), tx)]);
      out.set(id, { earningsIqd: sumFor(Accounts.driver(id), earnings), cashIqd: sumFor(Accounts.cash(id), cash) });
    }
    return out;
  }

  /** True when the group (by id) is already in the ledger. */
  async hasGroup(groupId: string, tx?: Tx): Promise<boolean> {
    return Boolean(await this.repo.findByIdempotencyKey(lineKey(groupId, 0), tx));
  }

  /** Balance is computed, never stored. */
  async balance(accountId: string, before?: Date): Promise<Balance> {
    const events = (await this.repo.byAccount(accountId)).filter((e) => !before || e.occurredAt < before);
    return { accountId, amount: sumFor(accountId, events), events: events.length };
  }

  async eventsFor(accountId: string): Promise<LedgerEvent[]> {
    return sortByTime(await this.repo.byAccount(accountId));
  }

  async eventsForTrip(tripId: string): Promise<LedgerEvent[]> {
    return this.repo.byTrip(tripId);
  }

  /** Every line carrying this order id, in recording order (support case view). */
  async eventsForOrder(orderId: string): Promise<LedgerEvent[]> {
    return sortByTime(await this.repo.byOrder(orderId));
  }

  /** Lines of these types that occurred in `[from, to)` (finance desk). */
  async eventsOfTypes(types: readonly LedgerEvent['type'][], from: Date, to: Date): Promise<LedgerEvent[]> {
    return sortByTime(await this.repo.byTypesBetween(types, from, to));
  }

  async eventsForGroups(groupIds: readonly string[]): Promise<LedgerEvent[]> {
    return sortByTime(await this.repo.byPostingGroups(groupIds));
  }

  /** Every account that ever appears, for the nightly per-driver report. */
  async accounts(): Promise<string[]> {
    const set = new Set<string>();
    for (const e of await this.repo.all()) {
      set.add(e.fromAccount);
      set.add(e.toAccount);
    }
    return [...set].sort();
  }

  /**
   * Account statement with Arabic line labels (packages/i18n `ledger.line.*`) and running balance.
   * `from` inclusive, `to` exclusive.
   */
  async statement(accountId: string, range: { from?: Date | undefined; to?: Date | undefined } = {}): Promise<Statement> {
    const events = await this.eventsFor(accountId);
    let opening = 0;
    let running = 0;
    let inIqd = 0;
    let outIqd = 0;
    const lines: StatementLine[] = [];
    for (const e of events) {
      const signed = (e.toAccount === accountId ? e.amount : 0) - (e.fromAccount === accountId ? e.amount : 0);
      if (range.from && e.occurredAt < range.from) {
        opening += signed;
        running += signed;
        continue;
      }
      if (range.to && e.occurredAt >= range.to) continue;
      running += signed;
      if (signed > 0) inIqd += signed;
      else outIqd -= signed;
      lines.push({
        id: e.id,
        occurredAt: e.occurredAt,
        type: e.type,
        label_ar: ledgerLineLabel(e.type, 'ar-IQ'),
        label_en: ledgerLineLabel(e.type, 'en'),
        accountId,
        counterparty: e.toAccount === accountId ? e.fromAccount : e.toAccount,
        amountIqd: signed,
        balanceAfterIqd: running,
        ...(e.orderId ? { orderId: e.orderId } : {}),
        ...(e.tripId ? { tripId: e.tripId } : {}),
        ...(e.memo ? { memo: e.memo } : {}),
      });
    }
    return { accountId, from: range.from ?? null, to: range.to ?? null, openingIqd: opening, closingIqd: running, inIqd, outIqd, lines };
  }

  /**
   * Double-entry invariant, per book: Σ over money accounts = 0 and Σ over points accounts = 0,
   * computed from the accounts each row actually touches. A row that crosses books (only possible
   * if something bypassed `record`) unbalances both and is counted as a kind violation.
   */
  async checkInvariant(): Promise<Invariant> {
    const events = await this.repo.all();
    let moneyNet = 0;
    let pointsNet = 0;
    let moneyEvents = 0;
    let pointsEvents = 0;
    let kindViolations = 0;
    for (const e of events) {
      for (const [account, sign] of [
        [e.toAccount, 1],
        [e.fromAccount, -1],
      ] as const) {
        if (isPointsAccount(account)) pointsNet += sign * e.amount;
        else moneyNet += sign * e.amount;
      }
      const kind = e.kind ?? kindOf(e.type);
      if (kind === 'points') pointsEvents += 1;
      else moneyEvents += 1;
      if (kind !== kindOf(e.type) || isPointsAccount(e.fromAccount) !== (kind === 'points') || isPointsAccount(e.toAccount) !== (kind === 'points')) kindViolations += 1;
    }
    const money = { ok: moneyNet === 0, net: moneyNet, events: moneyEvents };
    const points = { ok: pointsNet === 0, net: pointsNet, events: pointsEvents };
    return { ok: money.ok && points.ok && kindViolations === 0, net: moneyNet, events: events.length, money, points, kindViolations };
  }

  /**
   * Cash in the field (Console right-now bar): what every courier and driver holds right now, i.e.
   * the negative `cash:` balances, largest first. One pass over the book.
   * TODO(perf): a per-account balance projection once the book outgrows a full read per poll.
   */
  async cashInField(): Promise<{ totalIqd: number; holders: Array<{ driverId: string; amountIqd: number }> }> {
    const net = new Map<string, number>();
    for (const e of await this.repo.all()) {
      if (e.toAccount.startsWith('cash:')) net.set(e.toAccount, (net.get(e.toAccount) ?? 0) + e.amount);
      if (e.fromAccount.startsWith('cash:')) net.set(e.fromAccount, (net.get(e.fromAccount) ?? 0) - e.amount);
    }
    const holders = [...net.entries()]
      .filter(([, amount]) => amount < 0)
      .map(([account, amount]) => ({ driverId: account.slice('cash:'.length), amountIqd: -amount }))
      .sort((a, b) => b.amountIqd - a.amountIqd || a.driverId.localeCompare(b.driverId));
    return { totalIqd: holders.reduce((s, h) => s + h.amountIqd, 0), holders };
  }

  /** Completed cash orders of a customer at or above a size (referral unlock, new-customer cap). */
  async cashOrders(customerId: string, minIqd = 0): Promise<string[]> {
    const events = await this.repo.byAccount(Accounts.customer(customerId));
    const orders = new Set<string>();
    for (const e of events) {
      if (e.type !== 'cash_collected' || e.toAccount !== Accounts.customer(customerId) || !e.orderId) continue;
      if (e.amount >= minIqd) orders.add(e.orderId);
    }
    return [...orders];
  }
}

export class LedgerError extends Error {
  constructor(
    readonly code: 'invalid_amount' | 'same_account' | 'kind_mismatch' | 'invalid_account' | 'unbalanced',
    message: string,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}

export function sumFor(accountId: string, events: readonly LedgerEvent[]): number {
  let total = 0;
  for (const e of events) {
    if (e.toAccount === accountId) total += e.amount;
    if (e.fromAccount === accountId) total -= e.amount;
  }
  return total;
}

function lineKey(groupId: string, index: number): string {
  return `${groupId}#${index}`;
}

function sortByTime(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.recordedAt.getTime() - b.recordedAt.getTime());
}

/** Validates one line and returns its book. Points never create money: type, kind and both accounts must agree. */
function validateLine(event: { type: LedgerEvent['type']; kind?: LedgerKind | undefined; amount: number; fromAccount: string; toAccount: string }): LedgerKind {
  if (!Number.isInteger(event.amount) || event.amount <= 0) {
    throw new LedgerError('invalid_amount', `amount must be a positive integer IQD, got ${event.amount}`);
  }
  if (event.fromAccount === event.toAccount) {
    throw new LedgerError('same_account', `same account on both sides: ${event.fromAccount}`);
  }
  for (const account of [event.fromAccount, event.toAccount]) {
    if (!AccountId.safeParse(account).success) throw new LedgerError('invalid_account', `not a ledger account: ${account}`);
  }
  const kind = event.kind ?? kindOf(event.type);
  if (kind !== kindOf(event.type)) {
    throw new LedgerError('kind_mismatch', `${event.type} is a ${kindOf(event.type)} event, not ${kind}`);
  }
  for (const account of [event.fromAccount, event.toAccount]) {
    if (isPointsAccount(account) !== (kind === 'points')) {
      throw new LedgerError('kind_mismatch', `${kind} event ${event.type} cannot touch account ${account}`);
    }
  }
  return kind;
}

/** Every line valid and of the group's book; every control total met; the book nets to zero. */
export function validateGroup(g: PostingGroup): void {
  if (g.lines.length === 0) throw new LedgerError('unbalanced', `posting group ${g.id} has no lines`);
  const net = new Map<string, number>();
  for (const line of g.lines) {
    validateLine({ ...line, kind: g.kind });
    net.set(line.toAccount, (net.get(line.toAccount) ?? 0) + line.amount);
    net.set(line.fromAccount, (net.get(line.fromAccount) ?? 0) - line.amount);
  }
  let total = 0;
  for (const v of net.values()) total += v;
  if (total !== 0) throw new LedgerError('unbalanced', `posting group ${g.id} nets to ${total}`);
  for (const c of g.controls) {
    const actual = net.get(c.account) ?? 0;
    if (actual !== c.net) throw new LedgerError('unbalanced', `posting group ${g.id}: ${c.account} nets ${actual}, expected ${c.net}`);
  }
}
