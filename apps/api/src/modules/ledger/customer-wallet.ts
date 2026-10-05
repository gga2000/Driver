import { Inject, Injectable } from '@nestjs/common';
import {
  AZIZIYAH_ZONES,
  ledgerLineLabel,
  walletLineDetail,
  walletLineTitle,
  type Actor,
  type ClaimPointsOutput,
  type LedgerEvent,
  type LedgerEventType,
  type MoneyRules,
  type TopupOptionsView,
  type WalletBalanceView,
  type WalletLine,
  type WalletLineKind,
  type WalletPort,
  type WalletTransactionsInput,
  type WalletTransactionsView,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { Accounts } from './accounts.js';
import { LedgerService } from './ledger.service.js';
import type { PostingGroup } from './postings.js';
import { MONEY_RULES } from './tokens.js';

const DAY_MS = 86_400_000;
/** Domain §10: pending points for non-users lapse 90 days after they were earned. */
export const PENDING_POINTS_TTL_DAYS = 90;

/** What a purchase is made of (out of the payer's account); everything else in its group is settlement. */
const PURCHASE_TYPES: ReadonlySet<LedgerEventType> = new Set([
  'merchant_payable',
  'service_fee',
  'delivery_fee',
  'tip',
  'fare',
  'errand_cost_actual',
  'errand_fee',
  'seat_premium',
  'subscription_charge',
  'subscription_proration',
  'parcel_fee',
]);
/** Cash the customer handed over (into his account). */
const CASH_TYPES: ReadonlySet<LedgerEventType> = new Set(['cash_collected', 'cash_rounding_credit', 'cash_change_to_wallet']);

const signedFor = (account: string, e: LedgerEvent): number => (e.toAccount === account ? e.amount : 0) - (e.fromAccount === account ? e.amount : 0);

function purchaseKind(groupId: string, types: ReadonlySet<LedgerEventType>, memos: readonly string[]): WalletLineKind {
  if (types.has('subscription_charge') || types.has('subscription_proration')) return 'subscription';
  if (groupId.startsWith('seat:') || types.has('seat_premium')) return 'seat';
  if (types.has('errand_cost_actual') || types.has('errand_fee')) return 'errand';
  if (types.has('parcel_fee') || memos.some((m) => m.startsWith('parcel'))) return 'parcel';
  if (types.has('fare')) return 'ride';
  if (types.has('merchant_payable')) return 'food';
  return 'purchase';
}

function singleKind(e: LedgerEvent, signed: number): WalletLineKind {
  if (e.memo?.startsWith('topup')) return 'topup';
  switch (e.type) {
    case 'refund':
    case 'refund_cash_delivered':
      return 'refund';
    case 'credit_issued':
    case 'late_penalty_rider_credit':
    case 'cash_rounding_credit':
      return 'credit';
    case 'cash_change_to_wallet':
      return 'change_to_wallet';
    case 'cancellation_fee':
    case 'departure_cancel_fee':
      return 'penalty';
    case 'debt_settled':
      return 'debt';
    case 'adjustment':
      return 'adjustment';
    default:
      return signed >= 0 ? 'credit' : 'purchase';
  }
}

/**
 * Readable wallet lines for one account (customer spec §9): a whole order is ONE line (what it cost
 * and how it was paid), not its internal splits; when cash and the charge differ, the difference is
 * its own line (change kept as credit, or short cash owed). The rest of a note the courier had no
 * change for ("الخردة علينا") is a line of its own too, "باقي الكاش", apart from the rounding change.
 * Credits, refunds and fees stand alone.
 * Pure: the caller passes the account's ledger events.
 */
export function moneyLines(account: string, events: readonly LedgerEvent[]): WalletLine[] {
  const groups = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    if (e.kind !== 'money' || (e.toAccount !== account && e.fromAccount !== account)) continue;
    const key = e.postingGroupId ?? e.id;
    const list = groups.get(key);
    if (list) list.push(e);
    else groups.set(key, [e]);
  }
  const out: WalletLine[] = [];
  for (const [groupId, list] of groups) {
    const first = list[0]!;
    const refs = { ...(first.orderId ? { orderId: first.orderId } : {}), ...(first.tripId ? { tripId: first.tripId } : {}) };
    const purchases = list.filter((e) => e.fromAccount === account && PURCHASE_TYPES.has(e.type));
    if (purchases.length > 0) {
      const net = list.reduce((s, e) => s + signedFor(account, e), 0);
      const cash = list.filter((e) => e.toAccount === account && CASH_TYPES.has(e.type)).reduce((s, e) => s + e.amount, 0);
      // Charged = everything except the cash that paid for it: purchases, minus discounts, plus rounding.
      const charged = -list.filter((e) => !CASH_TYPES.has(e.type)).reduce((s, e) => s + signedFor(account, e), 0);
      const kind = purchaseKind(groupId, new Set(list.map((e) => e.type)), list.map((e) => e.memo ?? ''));
      const method = cash > 0 ? 'cash' : 'wallet';
      out.push({
        id: `${groupId}`,
        occurredAt: first.occurredAt,
        book: 'money',
        kind,
        title_ar: walletLineTitle(kind, 'ar-IQ'),
        title_en: walletLineTitle(kind, 'en'),
        detail_ar: walletLineDetail(method, 'ar-IQ'),
        detail_en: walletLineDetail(method, 'en'),
        amount: -charged,
        unit: 'iqd',
        method,
        ...refs,
      });
      const noChange = list.filter((e) => e.toAccount === account && e.type === 'cash_change_to_wallet').reduce((s, e) => s + e.amount, 0);
      const rest = net - noChange;
      if (method === 'cash' && rest !== 0) {
        const k = rest > 0 ? 'cash_change' : 'debt';
        const d = rest > 0 ? 'cash_change' : 'short_cash';
        out.push({
          id: `${groupId}:balance`,
          occurredAt: first.occurredAt,
          book: 'money',
          kind: k,
          title_ar: walletLineTitle(k, 'ar-IQ'),
          title_en: walletLineTitle(k, 'en'),
          detail_ar: walletLineDetail(d, 'ar-IQ'),
          detail_en: walletLineDetail(d, 'en'),
          amount: rest,
          unit: 'iqd',
          method: null,
          ...refs,
        });
      }
      if (noChange > 0) {
        out.push({
          id: `${groupId}:no_change`,
          occurredAt: first.occurredAt,
          book: 'money',
          kind: 'change_to_wallet',
          title_ar: walletLineTitle('change_to_wallet', 'ar-IQ'),
          title_en: walletLineTitle('change_to_wallet', 'en'),
          detail_ar: walletLineDetail('change_to_wallet', 'ar-IQ'),
          detail_en: walletLineDetail('change_to_wallet', 'en'),
          amount: noChange,
          unit: 'iqd',
          method: null,
          ...refs,
        });
      }
      continue;
    }
    for (const e of list) {
      const signed = signedFor(account, e);
      if (signed === 0) continue;
      const kind = singleKind(e, signed);
      const label = kind === 'topup' ? { ar: walletLineTitle('topup', 'ar-IQ'), en: walletLineTitle('topup', 'en') } : { ar: ledgerLineLabel(e.type, 'ar-IQ'), en: ledgerLineLabel(e.type, 'en') };
      out.push({
        id: e.id,
        occurredAt: e.occurredAt,
        book: 'money',
        kind,
        title_ar: label.ar,
        title_en: label.en,
        detail_ar: null,
        detail_en: null,
        amount: signed,
        unit: 'iqd',
        method: null,
        ...(e.orderId ? { orderId: e.orderId } : {}),
        ...(e.tripId ? { tripId: e.tripId } : {}),
      });
    }
  }
  return out;
}

/** Points movements of one points account, one line each (earned, bonus, claimed, used, expired). */
export function pointsLines(account: string, events: readonly LedgerEvent[]): WalletLine[] {
  return events
    .filter((e) => e.kind === 'points' && (e.toAccount === account || e.fromAccount === account))
    .map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt,
      book: 'points' as const,
      kind: 'points' as const,
      title_ar: ledgerLineLabel(e.type, 'ar-IQ'),
      title_en: ledgerLineLabel(e.type, 'en'),
      detail_ar: null,
      detail_en: null,
      amount: signedFor(account, e),
      unit: 'points' as const,
      method: null,
      ...(e.orderId ? { orderId: e.orderId } : {}),
      ...(e.tripId ? { tripId: e.tripId } : {}),
    }))
    .filter((l) => l.amount !== 0);
}

/** Newest first; a page never splits lines that share a timestamp, so `before` paging loses nothing. */
export function pageLines(lines: readonly WalletLine[], limit: number, before?: Date): WalletTransactionsView {
  const sorted = lines
    .filter((l) => !before || l.occurredAt < before)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || (a.book === b.book ? b.id.localeCompare(a.id) : a.book === 'money' ? -1 : 1));
  let end = Math.min(limit, sorted.length);
  while (end < sorted.length && end > 0 && sorted[end]!.occurredAt.getTime() === sorted[end - 1]!.occurredAt.getTime()) end += 1;
  const page = sorted.slice(0, end);
  return { lines: page, nextBefore: end < sorted.length ? page[page.length - 1]!.occurredAt : null };
}

/** Points worth in IQD (100 points = 1,000 IQD at Aziziyah rules). */
export function pointsWorthIqd(points: number, rules: Pick<MoneyRules, 'points'>): number {
  return points * rules.points.pointValueIqd;
}

/**
 * Claimable pending points: what is still pending and not past its 90 days. Pending credits are
 * consumed oldest-first by claims and expiries, so the live balance is matched against the newest
 * credits; the earliest of those sets the expiry shown.
 */
export function claimablePending(account: string, events: readonly LedgerEvent[], now: Date): { points: number; expiresAt: Date | null } {
  const balance = events.reduce((s, e) => s + (e.kind === 'points' ? signedFor(account, e) : 0), 0);
  if (balance <= 0) return { points: 0, expiresAt: null };
  const credits = events.filter((e) => e.kind === 'points' && e.toAccount === account).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  let left = balance;
  let live = 0;
  let expiresAt: Date | null = null;
  for (const c of credits) {
    if (left <= 0) break;
    const take = Math.min(left, c.amount);
    left -= take;
    const exp = new Date(c.occurredAt.getTime() + PENDING_POINTS_TTL_DAYS * DAY_MS);
    if (exp > now) {
      live += take;
      expiresAt = exp;
    }
  }
  return { points: live, expiresAt };
}

/** What the wallet needs from identity and orgs (narrow ports, bound in `LedgerModule`). */
export interface WalletPeople {
  phoneHashOf(personId: string): Promise<string | null>;
}
export type WalletHousehold = { id: string; name: string; role: 'payer' | 'orderer' | 'member' };
export interface WalletHouseholds {
  householdOf(personId: string): Promise<WalletHousehold | null> | WalletHousehold | null;
}
export const WALLET_PEOPLE = Symbol('WALLET_PEOPLE');
export const WALLET_HOUSEHOLDS = Symbol('WALLET_HOUSEHOLDS');

/** Agent shops for cash top-up (customer spec §9). Placeholder until the agent network is signed. */
const AGENTS = [
  { id: 'agent_centre', zoneId: 'centre', name_ar: 'وكيل شحن — مركز العزيزية', name_en: 'Top-up agent — town centre', hours_ar: 'كل يوم 9 الصبح – 10 الليل', hours_en: 'Daily 9am–10pm' },
  { id: 'agent_street_30', zoneId: 'street_30', name_ar: 'وكيل شحن — شارع 30', name_en: 'Top-up agent — Street 30', hours_ar: 'كل يوم 8 الصبح – 12 الليل', hours_en: 'Daily 8am–midnight' },
  { id: 'agent_hashimi', zoneId: 'hashimi', name_ar: 'وكيل شحن — الهاشمي', name_en: 'Top-up agent — Al-Hashimi', hours_ar: 'السبت – الخميس 9 – 9', hours_en: 'Sat–Thu 9–9' },
] as const;

/**
 * `ctx.wallet` (customer spec §9, domain §10, decisions §2): the caller's money balance, points and
 * their IQD worth, claimable pending points, readable lines and top-up channels. Reads only the
 * caller's own accounts (customer:<id>, points:<id>, points_pending:<own phone hash>, and the
 * household wallet he belongs to).
 */
@Injectable()
export class CustomerWalletService implements WalletPort {
  constructor(
    private readonly ledger: LedgerService,
    @Inject(MONEY_RULES) private readonly rules: MoneyRules,
    @Inject(WALLET_PEOPLE) private readonly people: WalletPeople,
    @Inject(WALLET_HOUSEHOLDS) private readonly households: WalletHouseholds,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async balance(actor: Actor): Promise<WalletBalanceView> {
    const id = actor.personId;
    const [money, points, pending] = await Promise.all([this.ledger.balance(Accounts.customer(id)), this.ledger.balance(Accounts.points(id)), this.pending(id)]);
    const home = await this.households.householdOf(id);
    const householdBalance = home ? (await this.ledger.balance(Accounts.household(home.id))).amount : 0;
    return {
      moneyIqd: money.amount,
      points: points.amount,
      pointsWorthIqd: pointsWorthIqd(points.amount, this.rules),
      pendingPoints: pending.points,
      pendingWorthIqd: pointsWorthIqd(pending.points, this.rules),
      pendingExpiresAt: pending.expiresAt,
      pointValueIqd: this.rules.points.pointValueIqd,
      household: home ? { id: home.id, name: home.name, role: home.role, balanceIqd: householdBalance } : null,
    };
  }

  async transactions(actor: Actor, input: z.infer<typeof WalletTransactionsInput>): Promise<WalletTransactionsView> {
    const id = actor.personId;
    const [money, points] = await Promise.all([this.ledger.eventsFor(Accounts.customer(id)), this.ledger.eventsFor(Accounts.points(id))]);
    return pageLines([...moneyLines(Accounts.customer(id), money), ...pointsLines(Accounts.points(id), points)], input.limit, input.before);
  }

  async topupOptions(_actor: Actor): Promise<TopupOptionsView> {
    return {
      placeholder: true,
      channels: [
        { id: 'agent', available: true, title_ar: 'اشحن من وكيل قريب', title_en: 'Top up at an agent', body_ar: 'ادفع كاش بأقرب وكيل ويوصل رصيدك بنفس الوقت', body_en: 'Pay cash at a nearby agent; the credit lands at once' },
        { id: 'driver', available: true, title_ar: 'اشحن كاش عن طريق السايق', title_en: 'Top up with your driver', body_ar: 'انطي السايق الفلوس ويوصل رصيدك بعد ما يأكد', body_en: 'Hand cash to your driver; credit lands when he confirms' },
        { id: 'zaincash', available: false, title_ar: 'زين كاش', title_en: 'ZainCash', body_ar: 'قريباً', body_en: 'Coming soon' },
      ],
      agents: AGENTS.map((a) => {
        const z = AZIZIYAH_ZONES.find((x) => x.id === a.zoneId)!;
        return {
          ...a,
          zoneName_ar: z.name_ar.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)),
          zoneName_en: z.name_en,
          pin: { lat: z.lat, lng: z.lng },
        };
      }),
    };
  }

  async claimPoints(actor: Actor): Promise<ClaimPointsOutput> {
    const id = actor.personId;
    const hash = await this.people.phoneHashOf(id);
    if (hash) {
      const account = Accounts.pointsPending(hash);
      const events = await this.ledger.eventsFor(account);
      const { points } = claimablePending(account, events, this.clock.now());
      if (points > 0) {
        const group: PostingGroup = {
          id: `points_claim:${id}:${events.length}`,
          kind: 'points',
          occurredAt: this.clock.now(),
          refs: {},
          lines: [{ type: 'points_claimed', amount: points, fromAccount: account, toAccount: Accounts.points(id), memo: 'claimed_on_verified_number' }],
          controls: [{ account: Accounts.points(id), net: points }],
        };
        const res = await this.ledger.recordAll(group);
        const after = (await this.ledger.balance(Accounts.points(id))).amount;
        return { claimed: res.recorded.length > 0 ? points : 0, points: after };
      }
    }
    return { claimed: 0, points: (await this.ledger.balance(Accounts.points(id))).amount };
  }

  private async pending(personId: string): Promise<{ points: number; expiresAt: Date | null }> {
    const hash = await this.people.phoneHashOf(personId);
    if (!hash) return { points: 0, expiresAt: null };
    const account = Accounts.pointsPending(hash);
    return claimablePending(account, await this.ledger.eventsFor(account), this.clock.now());
  }
}
