import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AZIZIYAH_ZONES,
  LATE_PROMISE_MEMO,
  ledgerLineLabel,
  walletLineDetail,
  walletLineTitle,
  walletOrderDetail,
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
import { t } from '@driver/i18n';
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
  // The tip after a good rating, on its own (`tip:<orderId>`): «إكرامية · طلب #3808».
  if (groupId.startsWith('tip:') && types.size === 1 && types.has('tip')) return 'tip';
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
      // The honest-delay credit (fee back, or the free-delivery 1,000) names itself and its order.
      return e.memo === LATE_PROMISE_MEMO ? 'late_credit' : 'credit';
    case 'late_penalty_rider_credit':
    case 'cash_rounding_credit':
      return 'credit';
    case 'cash_change_to_wallet':
      return 'change_to_wallet';
    case 'cancellation_fee':
    case 'departure_cancel_fee':
      // A driver's cancel fee paid to the customer (M-15, a الرجعة driver's late cancel) is credit, not «رسوم».
      return signed > 0 ? 'credit' : 'penalty';
    case 'debt_settled':
      return 'debt';
    case 'adjustment':
      return 'adjustment';
    default:
      return signed >= 0 ? 'credit' : 'purchase';
  }
}

/** `seat:<bookingId>.<seat>:money|points` → the booking; `topup:<id>` → the top-up request (w8). */
function lineRefs(groupId: string | null | undefined, memo: string | null | undefined): Pick<WalletLine, 'bookingId' | 'topUpId' | 'reference'> {
  const seat = groupId ? /^seat:([^.]+)\./.exec(groupId) : null;
  if (seat) return { bookingId: seat[1]! };
  const topup = groupId ? /^topup:(.+)$/.exec(groupId) : null;
  if (topup) {
    // memo `topup:<channel>:<reference>` (the receipt's T-XXXX-XXXX).
    const reference = memo?.split(':')[2];
    return { topUpId: topup[1]!, ...(reference ? { reference } : {}) };
  }
  return {};
}

/** 1 January of `now`'s year in Baghdad (UTC+3, no DST). */
export function baghdadYearStart(now: Date): Date {
  const local = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(local.getUTCFullYear(), 0, 1) - 3 * 3_600_000);
}

/**
 * «وفّرت هالسنة» (w10): what came back into the customer's account since 1 January — points spent on
 * fees and deals or promotions (`promo_funded`), the late-delivery credit and change kept in the wallet
 * (`cash_change_to_wallet`). Pure: the caller passes the account's events.
 */
export function savedThisYear(account: string, events: readonly LedgerEvent[], now: Date): number {
  return savedBetween(account, events, baghdadYearStart(now), new Date(now.getTime() + 1));
}

/**
 * «وفّرت» over `[from, to)`: the one definition behind the account header's year (w10) and the
 * month page «شهرك» (w6) — points spent on fees, deals and promotions (`promo_funded`), the
 * late-delivery credit and change kept in the wallet. Pure: the caller passes the account's events.
 */
export function savedBetween(account: string, events: readonly LedgerEvent[], from: Date, to: Date): number {
  return events
    .filter((e) => e.kind === 'money' && e.toAccount === account && e.occurredAt.getTime() >= from.getTime() && e.occurredAt.getTime() < to.getTime())
    .filter((e) => e.type === 'promo_funded' || e.type === 'cash_change_to_wallet' || (e.type === 'credit_issued' && e.memo === LATE_PROMISE_MEMO))
    .reduce((s, e) => s + e.amount, 0);
}

/**
 * Readable wallet lines for one account (customer spec §9): a whole order is ONE line (what it cost
 * and how it was paid), not its internal splits; when cash and the charge differ, the difference is
 * its own line (change kept as credit, or short cash owed). The rest of a note the courier had no
 * change for ("الخردة علينا") is a line of its own too, "باقي الكاش", apart from the rounding change.
 * Credits, refunds and fees stand alone; the honest-delay credit says so and names its order
 * («تعويض التأخير · طلب #3808»).
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
    const refs = { ...(first.orderId ? { orderId: first.orderId } : {}), ...(first.tripId ? { tripId: first.tripId } : {}), ...lineRefs(first.postingGroupId, first.memo) };
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
        detail_ar: kind === 'tip' && first.orderId ? walletOrderDetail(first.orderId, 'ar-IQ') : walletLineDetail(method, 'ar-IQ'),
        detail_en: kind === 'tip' && first.orderId ? walletOrderDetail(first.orderId, 'en') : walletLineDetail(method, 'en'),
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
      const label =
        kind === 'topup' || kind === 'late_credit'
          ? { ar: walletLineTitle(kind, 'ar-IQ'), en: walletLineTitle(kind, 'en') }
          : e.type === 'departure_cancel_fee' && signed > 0
            ? // A الرجعة driver who cancelled late or never came (M-11) pays the rider: say why, not «رسوم».
              { ar: t('wallet.line.departure_credit', undefined, 'ar-IQ'), en: t('wallet.line.departure_credit', undefined, 'en') }
            : { ar: ledgerLineLabel(e.type, 'ar-IQ'), en: ledgerLineLabel(e.type, 'en') };
      const orderDetail = kind === 'late_credit' && e.orderId ? { ar: walletOrderDetail(e.orderId, 'ar-IQ'), en: walletOrderDetail(e.orderId, 'en') } : null;
      out.push({
        id: e.id,
        occurredAt: e.occurredAt,
        book: 'money',
        kind,
        title_ar: label.ar,
        title_en: label.en,
        detail_ar: orderDetail?.ar ?? null,
        detail_en: orderDetail?.en ?? null,
        amount: signed,
        unit: 'iqd',
        method: null,
        ...(e.orderId ? { orderId: e.orderId } : {}),
        ...(e.tripId ? { tripId: e.tripId } : {}),
        ...lineRefs(e.postingGroupId, e.memo),
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
      ...lineRefs(e.postingGroupId, e.memo),
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

/** A signed top-up agent shop (customer spec §9): where, its name and its hours. */
export interface TopupAgentDef {
  id: string;
  zoneId: string;
  name_ar: string;
  name_en: string;
  hours_ar: string;
  hours_en: string;
}

export const TOPUP_AGENTS = Symbol('TOPUP_AGENTS');

/**
 * FLOW-24 (W3): only real, signed agents are ever listed — from `TOPUP_AGENTS_JSON` (an array of
 * `TopupAgentDef`, set when the agent network is signed). None set = the agent channel is shown as not
 * available yet and no shop is listed (the three placeholder shops are gone: people walked to them).
 * Rows with a zone the city does not know are dropped.
 */
export function topupAgentsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): TopupAgentDef[] {
  const raw = env['TOPUP_AGENTS_JSON'];
  if (!raw) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return rows.flatMap((r: Record<string, unknown>) => {
      const a = { id: str(r['id']), zoneId: str(r['zoneId']), name_ar: str(r['name_ar']), name_en: str(r['name_en']), hours_ar: str(r['hours_ar']), hours_en: str(r['hours_en']) };
      if (Object.values(a).some((v) => v === null) || !AZIZIYAH_ZONES.some((z) => z.id === a.zoneId)) return [];
      return [a as TopupAgentDef];
    });
  } catch {
    return [];
  }
}

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
    @Optional() @Inject(TOPUP_AGENTS) private readonly agents: readonly TopupAgentDef[] = topupAgentsFromEnv(),
  ) {}

  async balance(actor: Actor): Promise<WalletBalanceView> {
    const id = actor.personId;
    const [money, points, pending, events] = await Promise.all([this.ledger.balance(Accounts.customer(id)), this.ledger.balance(Accounts.points(id)), this.pending(id), this.ledger.eventsFor(Accounts.customer(id))]);
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
      pointsMaxPerOrder: this.rules.points.maxPerOrder,
      savedThisYearIqd: savedThisYear(Accounts.customer(id), events, this.clock.now()),
    };
  }

  async transactions(actor: Actor, input: z.infer<typeof WalletTransactionsInput>): Promise<WalletTransactionsView> {
    const id = actor.personId;
    const [money, points] = await Promise.all([this.ledger.eventsFor(Accounts.customer(id)), this.ledger.eventsFor(Accounts.points(id))]);
    return pageLines([...moneyLines(Accounts.customer(id), money), ...pointsLines(Accounts.points(id), points)], input.limit, input.before);
  }

  async topupOptions(_actor: Actor): Promise<TopupOptionsView> {
    const agentsLive = this.agents.length > 0;
    return {
      // FLOW-24: never placeholder shops any more; agents are listed only once signed (`TOPUP_AGENTS_JSON`).
      placeholder: false,
      channels: [
        agentsLive
          ? { id: 'agent', available: true, title_ar: 'اشحن من وكيل قريب', title_en: 'Top up at an agent', body_ar: 'ادفع كاش بأقرب وكيل ويوصل رصيدك بنفس الوقت', body_en: 'Pay cash at a nearby agent; the credit lands at once' }
          : { id: 'agent', available: false, title_ar: 'اشحن من وكيل قريب', title_en: 'Top up at an agent', body_ar: 'قريباً', body_en: 'Coming soon' },
        // THIN-11: only the courier bringing a live delivery can take the cash (taxi and tuktuk drivers cannot yet).
        { id: 'driver', available: true, title_ar: 'اشحن عن طريق الدليفري', title_en: 'Top up with your courier', body_ar: 'انطي الفلوس للدليفري اللي جايب طلبك، قبل ما يسلّمك الطلب. يوصل رصيدك بعد ما يأكد', body_en: 'Hand cash to the courier bringing your order, before he hands it over; credit lands when he confirms' },
        { id: 'zaincash', available: false, title_ar: 'زين كاش', title_en: 'ZainCash', body_ar: 'قريباً', body_en: 'Coming soon' },
      ],
      agents: this.agents.map((a) => {
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
