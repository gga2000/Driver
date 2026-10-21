import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  CapRole,
  DriverError,
  ledgerLineLabel,
  type Actor,
  type EarningsJobLine,
  type Order,
  type OrderSummary,
} from '@driver/contracts';
import {
  PEOPLE_WINDOW_DAYS,
  type CustomerFilter,
  type CustomerProfile,
  type CustomerRow,
  type CustomerSegment,
  type CustomersPage,
  type DriverPeopleProfile,
  type PeopleCustomersInput,
  type PeoplePort,
  type PersonInput,
  type ProfileSignal,
  type ProfileTicket,
  type RevealedPhone,
  type RevealPhoneInput,
  type StoryInput,
  type StoryItem,
  type StoryPage,
} from '@driver/contracts/people';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { localDow, localHour, startOfLocalDay, startOfLocalWeek } from '../../shared/local-time.js';
import { DispatchService } from '../dispatch/index.js';
import { DriverAccountService } from '../driver-account/index.js';
import { FleetService } from '../fleet/index.js';
import { IdentityService, type RosterRow } from '../identity/index.js';
import { AuditLogService } from '../controls/index.js';
import { CapsService, LedgerService } from '../ledger/index.js';
import { ACTIVE_ORDER_STATES, OrdersService } from '../orders/index.js';
import { ScoringService } from '../scoring/index.js';
import { SupportService, type TicketRecord } from '../support/index.js';
import { CUSTOMER_CREDIT_TYPES } from './console.reads.js';
import { cashHeld, pinState } from './driver-state.js';

/** Vault purpose of the profile header and the list's name / last-4 search (a fail-closed staff read). */
export const CONSOLE_PEOPLE_PURPOSE = 'console_people';
/** Vault purpose of «اكشف الرقم»: the whole number, one access row per reveal. */
export const CONSOLE_PHONE_REVEAL_PURPOSE = 'console_phone_reveal';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
/** The city scan behind the list is kept this long (the list pages and polls on it). */
const SCAN_TTL_MS = 60_000;
/** Pages of the bounded city scan (each `TICKET_SCAN_LIMIT`-sized in the orders module). */
const SCAN_PAGE = 5_000;
const SCAN_PAGES = 6;
/** Customers the list reads at most (a town's customers, a few thousand). */
const CUSTOMER_SCAN_LIMIT = 20_000;
const NEW_DAYS = 14;
const REGULAR_DELIVERED_30D = 4;

const DELIVERED: ReadonlySet<string> = new Set(['delivered', 'completed', 'closed']);
const CANCELLED: ReadonlySet<string> = new Set([
  'merchant_rejected',
  'customer_cancelled',
  'platform_cancelled',
  'failed',
]);
const OPEN_TICKET: ReadonlySet<string> = new Set(['open', 'waiting', 'escalated']);
/** Taxi and tuktuk rides (not a delivered basket: kept out of the average order). */
const RIDE_TYPES: ReadonlySet<string> = new Set(['ride']);

interface CustomerStats {
  orders: number;
  delivered: number;
  spentIqd: number;
  delivered30d: number;
  orders30d: number;
  lastOrderAt: Date | null;
  weekly: number[];
  zones: Map<string, number>;
}

interface CityScan {
  at: number;
  from: Date;
  byCustomer: Map<string, CustomerStats>;
  activePrev30d: number;
  cityAvgOrderIqd: number | null;
}

/**
 * «الناس» (Ali, 2026-10-21): the Console's customers list and the customer and driver profiles.
 * Composed from the owning modules' public services like the rest of the Console's read side —
 * the roster and the vault from identity, orders from orders, money from the ledger, tickets from
 * support, presence from dispatch, earnings, documents and the scorecard from the driver account —
 * and owns no tables. The list's numbers come from one bounded scan of the city's orders over the
 * last `PEOPLE_WINDOW_DAYS` days, kept for a minute.
 */
@Injectable()
export class PeopleReadService implements PeoplePort {
  private scans = new Map<string, CityScan>();

  constructor(
    private readonly identity: IdentityService,
    private readonly orders: OrdersService,
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    private readonly dispatch: DispatchService,
    private readonly scoring: ScoringService,
    private readonly fleet: FleetService,
    private readonly support: SupportService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly accounts?: DriverAccountService,
    /** «اكشف الرقم» also lands in the Console's audit page (who pressed what, and why). */
    @Optional() private readonly audits?: AuditLogService,
  ) {}

  // ───────────────────────── customers list ─────────────────────────

  async customers(
    input: z.output<typeof PeopleCustomersInput>,
    accessorId: string,
  ): Promise<CustomersPage> {
    const now = this.clock.now();
    const [scan, roster, open] = await Promise.all([
      this.cityScan(input.cityId, now),
      this.identity.roster({ kinds: ['customer'], limit: CUSTOMER_SCAN_LIMIT }),
      this.support.openTicketsByCustomer(input.cityId),
    ]);
    const all = roster.rows.map((r) =>
      this.row(r, scan.byCustomer.get(r.personId), open.get(r.personId) ?? 0, now),
    );
    const counts: Record<CustomerFilter, number> = {
      all: all.length,
      new: 0,
      regular: 0,
      lapsed: 0,
      issue: 0,
      frozen: 0,
    };
    for (const r of all) if (r.segment in counts) counts[r.segment as CustomerFilter] += 1;

    let rows = input.filter === 'all' ? all : all.filter((r) => r.segment === input.filter);
    const q = input.q?.trim();
    if (q) rows = await this.search(rows, q, accessorId);
    // Most recent customers first: the last order, then the join date.
    rows.sort(
      (a, b) =>
        (b.lastOrderAt?.getTime() ?? 0) - (a.lastOrderAt?.getTime() ?? 0) ||
        b.joinedAt.getTime() - a.joinedAt.getTime() ||
        a.personId.localeCompare(b.personId),
    );
    const start = input.cursor ? rows.findIndex((r) => r.personId === input.cursor) + 1 : 0;
    const page = rows.slice(start, start + input.limit);
    const active30d = [...scan.byCustomer.values()].filter((s) => s.orders30d > 0).length;
    return {
      rows: page,
      nextCursor: start + input.limit < rows.length ? (page.at(-1)?.personId ?? null) : null,
      total: rows.length,
      counts,
      active30d,
      activePrev30d: scan.activePrev30d,
      windowFrom: scan.from,
    };
  }

  /** A name (identity's logged match), the last four digits of the number, or a piece of the id. */
  private async search(rows: CustomerRow[], q: string, accessorId: string): Promise<CustomerRow[]> {
    const ids = rows.map((r) => r.personId);
    const digits = q.replace(/[\s-]/g, '');
    let hits: string[];
    if (/^\d{4}$/.test(digits))
      hits = await this.identity.matchPhoneTails(ids, digits, accessorId, CONSOLE_PEOPLE_PURPOSE);
    else if (/^[a-z0-9_]+$/i.test(q) && q.length >= 4)
      hits = ids.filter((id) => id.toLowerCase().includes(q.toLowerCase()));
    else hits = await this.identity.matchDisplayNames(ids, q, accessorId, CONSOLE_PEOPLE_PURPOSE);
    const set = new Set(hits);
    return rows.filter((r) => set.has(r.personId));
  }

  private row(
    r: RosterRow,
    s: CustomerStats | undefined,
    openTickets: number,
    now: Date,
  ): CustomerRow {
    const zone = s ? ([...s.zones.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null) : null;
    return {
      personId: r.personId,
      segment: segmentOf({ frozen: r.frozen, openTickets, joinedAt: r.joinedAt, stats: s, now }),
      frozen: r.frozen,
      joinedAt: r.joinedAt,
      orders: s?.orders ?? 0,
      delivered: s?.delivered ?? 0,
      spentIqd: s?.spentIqd ?? 0,
      lastOrderAt: s?.lastOrderAt ?? null,
      weekly: s?.weekly.slice(-8) ?? Array(8).fill(0),
      zoneKey: zone,
      openTickets,
    };
  }

  /** The city's orders over the window, per customer (one bounded scan, kept for `SCAN_TTL_MS`). */
  private async cityScan(cityId: string, now: Date): Promise<CityScan> {
    const cached = this.scans.get(cityId);
    if (cached && now.getTime() - cached.at < SCAN_TTL_MS) return cached;
    const from = new Date(startOfLocalDay(now).getTime() - PEOPLE_WINDOW_DAYS * DAY_MS);
    const rows: OrderSummary[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < SCAN_PAGES; i++) {
      const page = await this.orders.search({ cityId, from, limit: SCAN_PAGE, cursor });
      rows.push(...page.rows);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    const weekStart = startOfLocalWeek(now).getTime();
    const d30 = now.getTime() - 30 * DAY_MS;
    const d60 = now.getTime() - 60 * DAY_MS;
    const byCustomer = new Map<string, CustomerStats>();
    const prev = new Set<string>();
    let sum = 0;
    let n = 0;
    for (const o of rows) {
      const t = o.placedAt.getTime();
      if (t >= d60 && t < d30) prev.add(o.ordererId);
      let s = byCustomer.get(o.ordererId);
      if (!s)
        byCustomer.set(
          o.ordererId,
          (s = {
            orders: 0,
            delivered: 0,
            spentIqd: 0,
            delivered30d: 0,
            orders30d: 0,
            lastOrderAt: null,
            weekly: Array(12).fill(0),
            zones: new Map(),
          }),
        );
      s.orders += 1;
      if (t >= d30) s.orders30d += 1;
      if (DELIVERED.has(o.state)) {
        s.delivered += 1;
        s.spentIqd += o.totalIqd;
        if (t >= d30) s.delivered30d += 1;
        if (o.type !== 'ride') {
          sum += o.totalIqd;
          n += 1;
        }
      }
      if (!s.lastOrderAt || o.placedAt > s.lastOrderAt) s.lastOrderAt = o.placedAt;
      const w = 11 - Math.floor((weekStart - startOfLocalWeek(o.placedAt).getTime()) / WEEK_MS);
      if (w >= 0 && w < 12) s.weekly[w]! += 1;
      if (o.zoneKey) s.zones.set(o.zoneKey, (s.zones.get(o.zoneKey) ?? 0) + 1);
    }
    const scan: CityScan = {
      at: now.getTime(),
      from,
      byCustomer,
      activePrev30d: prev.size,
      cityAvgOrderIqd: n > 0 ? Math.round(sum / n / 250) * 250 : null,
    };
    this.scans.set(cityId, scan);
    return scan;
  }

  // ───────────────────────── one customer ─────────────────────────

  async customer(
    input: z.output<typeof PersonInput>,
    accessorId: string,
  ): Promise<CustomerProfile> {
    const now = this.clock.now();
    const { personId, cityId } = input;
    const entry = await this.identity.rosterEntry(personId, ['customer']);
    if (!entry) throw new DriverError('not_found');
    const since365 = new Date(now.getTime() - 365 * DAY_MS);
    const [cards, active, all, recent, live, tickets, scan, credits] = await Promise.all([
      this.identity.memberCards([personId], accessorId, CONSOLE_PEOPLE_PURPOSE),
      this.identity.lastActiveAtOf([personId]),
      this.orders.listForPerson(personId),
      this.orders.search({ cityId, ordererIds: [personId], limit: 10 }),
      this.orders.search({ cityId, ordererIds: [personId], states: ACTIVE_ORDER_STATES, limit: 5 }),
      this.support.ticketsOfCustomer(personId, since365),
      this.cityScan(cityId, now),
      this.ledger.eventsSince(`customer:${personId}`, new Date(now.getTime() - 30 * DAY_MS)),
    ]);
    const mine = all.filter((o) => o.ordererId === personId);
    const delivered = mine.filter((o) => DELIVERED.has(o.state));
    const rides = mine.filter((o) => RIDE_TYPES.has(o.type));
    const goods = delivered.filter((o) => !RIDE_TYPES.has(o.type));
    const times = mine.map((o) => o.placedAt.getTime()).sort((a, b) => a - b);
    const weekStart = startOfLocalWeek(now).getTime();
    const weekly = Array<number>(12).fill(0);
    const hours = Array<number>(24).fill(0);
    const services = new Map<Order['type'], number>();
    const merchants = new Map<string, number>();
    const payment = { cash: 0, wallet: 0, other: 0 };
    for (const o of mine) {
      const w = 11 - Math.floor((weekStart - startOfLocalWeek(o.placedAt).getTime()) / WEEK_MS);
      if (w >= 0 && w < 12) weekly[w]! += 1;
      hours[localHour(o.placedAt)]! += 1;
      services.set(o.type, (services.get(o.type) ?? 0) + 1);
      if (o.merchantOrgId)
        merchants.set(o.merchantOrgId, (merchants.get(o.merchantOrgId) ?? 0) + 1);
      if (o.paymentMethod === 'cash') payment.cash += 1;
      else if (o.paymentMethod === 'wallet') payment.wallet += 1;
      else payment.other += 1;
    }
    const ratings = mine
      .map((o) => o.rating?.delivery ?? null)
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .map(Number);
    const creditLines = credits.filter(
      (e) =>
        e.kind === 'money' &&
        e.toAccount === `customer:${personId}` &&
        CUSTOMER_CREDIT_TYPES.has(e.type),
    );
    const credits30dIqd = creditLines.reduce((a, e) => a + e.amount, 0);
    const openTickets = tickets.filter((t) => OPEN_TICKET.has(t.status));
    const stats = scan.byCustomer.get(personId);
    const segment = segmentOf({
      frozen: entry.frozen,
      openTickets: openTickets.length,
      joinedAt: entry.joinedAt,
      stats,
      now,
    });
    const lateRecent = recent.rows.filter(
      (o) => o.placedAt.getTime() >= now.getTime() - 30 * DAY_MS && o.late,
    ).length;
    const totals = {
      orders: mine.length,
      delivered: delivered.length,
      cancelled: mine.filter((o) => CANCELLED.has(o.state)).length,
      rides: rides.length,
      spentIqd: delivered.reduce((a, o) => a + o.totalIqd, 0),
      avgOrderIqd:
        goods.length > 0
          ? Math.round(goods.reduce((a, o) => a + o.totalIqd, 0) / goods.length / 250) * 250
          : null,
      cityAvgOrderIqd: scan.cityAvgOrderIqd,
      firstOrderAt: times.length ? new Date(times[0]!) : null,
      lastOrderAt: times.length ? new Date(times.at(-1)!) : null,
      everyDays: medianGapDays(times),
    };
    const ratingAvg = ratings.length
      ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
      : null;
    return {
      personId,
      name: cards[personId]?.name ?? null,
      phoneMasked: cards[personId]?.phoneMasked ?? null,
      joinedAt: entry.joinedAt,
      frozen: entry.frozen,
      trustTier: entry.trustTier,
      lastActiveAt: active[personId] ?? null,
      segment,
      totals,
      payment,
      weekly,
      hours,
      services: [...services.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      topMerchants: [...merchants.entries()]
        .map(([orgId, count]) => ({ orgId, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
      live: live.rows,
      recent: recent.rows,
      credits30dIqd,
      ratingAvg,
      ratingCount: ratings.length,
      tickets: {
        open: openTickets.length,
        total: tickets.length,
        recent: tickets.slice(0, 5).map(profileTicket),
      },
      signals: customerSignals({
        segment,
        totals,
        hours,
        credits30dIqd,
        creditCount: creditLines.length,
        lateRecent,
        openTickets: openTickets.length,
        ratingAvg,
        ratingCount: ratings.length,
        frozen: entry.frozen,
        now,
      }),
    };
  }

  // ───────────────────────── one driver ─────────────────────────

  async driver(
    input: z.output<typeof PersonInput>,
    accessorId: string,
  ): Promise<DriverPeopleProfile> {
    const now = this.clock.now();
    const { personId, cityId } = input;
    const entry = await this.identity.rosterEntry(personId, CapRole.options);
    if (!entry) throw new DriverError('not_found');
    const [cards, active, live, vehicles, card, cap, jobs, docs, ratings] = await Promise.all([
      this.identity.memberCards([personId], accessorId, CONSOLE_PEOPLE_PURPOSE),
      this.identity.lastActiveAtOf([personId]),
      this.dispatch
        .liveDrivers(cityId, now)
        .then((all) => all.find((d) => d.presence.driverId === personId) ?? null),
      this.fleet.activeVehiclesOf([personId]),
      this.accounts ? this.accounts.scorecardFor(personId, true) : Promise.resolve(null),
      this.caps.status(personId),
      this.jobLines(personId, now),
      this.accounts ? this.accounts.documentsFor(personId) : Promise.resolve(null),
      this.orders.courierRatings(personId),
    ]);
    const tier = card
      ? card.tier
      : (await this.scoring.scorecard(personId, entry.joinedAt, now)).tier;
    const vehicle = vehicles.get(personId);
    const weekFrom = startOfLocalWeek(now).getTime();
    const lastWeekFrom = weekFrom - WEEK_MS;
    const week = { jobs: 0, netIqd: 0, tipsIqd: 0 };
    const lastWeek = { jobs: 0, netIqd: 0 };
    const today = startOfLocalDay(now).getTime();
    const daily = Array.from({ length: 14 }, (_, i) => ({
      day: new Date(today - (13 - i) * DAY_MS),
      netIqd: 0,
      jobs: 0,
    }));
    const heat = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const j of jobs) {
      const t = j.at.getTime();
      const isJob = j.tripId !== null || j.orderId !== null;
      if (t >= weekFrom) {
        week.netIqd += j.netIqd;
        week.tipsIqd += j.components
          .filter((c) => c.type === 'tip')
          .reduce((a, c) => a + c.amountIqd, 0);
        if (isJob) week.jobs += 1;
      } else if (t >= lastWeekFrom) {
        lastWeek.netIqd += j.netIqd;
        if (isJob) lastWeek.jobs += 1;
      }
      const d = Math.floor((startOfLocalDay(j.at).getTime() - daily[0]!.day.getTime()) / DAY_MS);
      if (d >= 0 && d < 14) {
        daily[d]!.netIqd += j.netIqd;
        if (isJob) daily[d]!.jobs += 1;
      }
      if (isJob && t >= today - 27 * DAY_MS) heat[localDow(j.at)]![localHour(j.at)]! += 1;
    }
    const orderIds = [
      ...new Set(jobs.map((j) => j.orderId).filter((x): x is string => x !== null)),
    ];
    const complaints = (await this.support.ticketsOnOrders(orderIds)).filter(
      (t) => t.kind !== 'question' && t.kind !== 'deletion',
    );
    const scores = ratings.map((r) => r.score);
    return {
      personId,
      name: cards[personId]?.name ?? null,
      phoneMasked: cards[personId]?.phoneMasked ?? null,
      roles: entry.roles.filter((k): k is CapRole =>
        (CapRole.options as readonly string[]).includes(k),
      ),
      frozen: entry.frozen,
      joinedAt: entry.joinedAt,
      trustTier: entry.trustTier,
      vehicle: vehicle
        ? { vehicleClass: vehicle.vehicleClass, plate: vehicle.plate }
        : live
          ? { vehicleClass: live.presence.vehicle, plate: null }
          : null,
      live: live
        ? {
            state: pinState(live.state, cap.overCap),
            zoneId: live.presence.zoneId,
            lastSeenAt: new Date(live.presence.lastSeenAt),
            tripId: live.tripId,
          }
        : null,
      lastActiveAt: active[personId] ?? null,
      score: {
        tier,
        index: card?.index ?? null,
        observation: card?.observation ?? false,
        completedTrips: card?.completedTrips ?? 0,
        metrics: (card?.metrics ?? []).map((m) => ({
          key: m.key,
          label: m.label_ar,
          display: m.display,
          value: m.value,
          samples: m.samples,
        })),
      },
      week,
      lastWeek,
      daily,
      heat,
      cash: {
        heldIqd: cashHeld(cap.cashIqd),
        owedIqd: cap.owedIqd,
        capIqd: cap.capIqd,
        overCap: cap.overCap,
      },
      docs: docs
        ? {
            documents: docs.documents.map((d) => ({
              kind: d.kind,
              status: d.status,
              expiresAt: d.expiresAt,
            })),
            missing: docs.missing,
            blocksOnline: docs.blocksOnline,
          }
        : { documents: [], missing: [], blocksOnline: false },
      ratings: {
        avg: scores.length
          ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
          : null,
        count: scores.length,
        recent: ratings
          .slice(0, 8)
          .map((r) => ({ orderId: r.orderId, score: r.score, reasons: r.reasons, at: r.at })),
      },
      complaints: {
        total: complaints.length,
        recent: complaints
          .slice(0, 5)
          .map((t) => ({ ...profileTicket(t), faultParty: t.faultParty })),
      },
    };
  }

  /** His pay lines over the last five Sunday-start weeks (covers the 28-day heat and the 14 days). */
  private async jobLines(driverId: string, now: Date): Promise<EarningsJobLine[]> {
    if (!this.accounts) return [];
    const weeks = await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        this.accounts!.earningsFor(driverId, 'week', new Date(now.getTime() - i * WEEK_MS)),
      ),
    );
    const seen = new Set<string>();
    const out: EarningsJobLine[] = [];
    for (const w of weeks)
      for (const j of w.jobs) {
        if (seen.has(j.key)) continue;
        seen.add(j.key);
        out.push(j);
      }
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  // ───────────────────────── the story ─────────────────────────

  async story(input: z.output<typeof StoryInput>): Promise<StoryPage> {
    const now = this.clock.now();
    const before = input.before ?? new Date(now.getTime() + 1);
    const want = (k: StoryItem['kind']) =>
      !input.kinds || input.kinds.length === 0 || input.kinds.includes(k);
    const items: StoryItem[] =
      input.who === 'customer'
        ? await this.customerStory(input.personId, want)
        : await this.driverStory(input.personId, now, want);
    const older = items
      .filter((i) => i.at < before)
      .sort((a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id));
    const page = older.slice(0, input.limit);
    return {
      items: page,
      nextBefore: older.length > input.limit ? (page.at(-1)?.at ?? null) : null,
    };
  }

  private async customerStory(
    personId: string,
    want: (k: StoryItem['kind']) => boolean,
  ): Promise<StoryItem[]> {
    const since = new Date(this.clock.now().getTime() - 365 * DAY_MS);
    const [orders, lines, tickets] = await Promise.all([
      want('order') || want('rating')
        ? this.orders.listForPerson(personId)
        : Promise.resolve([] as Order[]),
      want('money') ? this.ledger.eventsSince(`customer:${personId}`, since) : Promise.resolve([]),
      want('ticket')
        ? this.support.ticketsOfCustomer(personId, since)
        : Promise.resolve([] as TicketRecord[]),
    ]);
    const out: StoryItem[] = [];
    for (const o of orders.filter((x) => x.ordererId === personId)) {
      if (want('order'))
        out.push(
          storyItem({
            id: `o:${o.id}`,
            at: o.placedAt,
            kind: 'order',
            orderId: o.id,
            orderType: o.type,
            state: o.state,
            merchantOrgId: o.merchantOrgId,
            amountIqd: o.totalIqd,
          }),
        );
      const score = o.rating?.delivery ?? null;
      if (want('rating') && o.rating && score !== null)
        out.push(
          storyItem({
            id: `r:${o.id}`,
            at: o.rating.ratedAt,
            kind: 'rating',
            orderId: o.id,
            orderType: o.type,
            score: Number(score),
          }),
        );
    }
    const account = `customer:${personId}`;
    for (const e of lines) {
      if (e.kind !== 'money' || e.toAccount !== account || !CUSTOMER_CREDIT_TYPES.has(e.type))
        continue;
      out.push(
        storyItem({
          id: `m:${e.id}`,
          at: e.occurredAt,
          kind: 'money',
          orderId: e.orderId ?? null,
          amountIqd: e.amount,
          label: ledgerLineLabel(e.type, 'ar-IQ'),
        }),
      );
    }
    for (const t of tickets)
      out.push(
        storyItem({
          id: `t:${t.id}`,
          at: t.openedAt,
          kind: 'ticket',
          orderId: t.orderId,
          ticketId: t.id,
          ticketStatus: t.status,
          label: t.subject,
          amountIqd: t.refundedIqd || null,
        }),
      );
    return out;
  }

  private async driverStory(
    personId: string,
    now: Date,
    want: (k: StoryItem['kind']) => boolean,
  ): Promise<StoryItem[]> {
    const jobs = await this.jobLines(personId, now);
    const out: StoryItem[] = [];
    if (want('order') || want('money')) {
      for (const j of jobs) {
        const isJob = j.tripId !== null || j.orderId !== null;
        if (isJob ? want('order') : want('money')) {
          out.push(
            storyItem({
              id: `j:${j.key}`,
              at: j.at,
              kind: isJob ? 'order' : 'money',
              orderId: j.orderId,
              amountIqd: j.netIqd,
              label: isJob ? null : (j.components[0]?.label_ar ?? null),
            }),
          );
        }
      }
    }
    if (want('rating'))
      for (const r of await this.orders.courierRatings(personId))
        out.push(
          storyItem({
            id: `r:${r.orderId}`,
            at: r.at,
            kind: 'rating',
            orderId: r.orderId,
            score: r.score,
          }),
        );
    if (want('ticket')) {
      const orderIds = [
        ...new Set(jobs.map((j) => j.orderId).filter((x): x is string => x !== null)),
      ];
      for (const t of await this.support.ticketsOnOrders(orderIds))
        out.push(
          storyItem({
            id: `t:${t.id}`,
            at: t.openedAt,
            kind: 'ticket',
            orderId: t.orderId,
            ticketId: t.id,
            ticketStatus: t.status,
            label: t.subject,
          }),
        );
    }
    return out;
  }

  // ───────────────────────── reveal ─────────────────────────

  /**
   * The whole number for a reason the staff member picks: one vault access row (a fail-closed staff
   * read) and one Console audit row carrying the reason, so «منو شاف الرقم» has the who and the why.
   */
  async revealPhone(
    actor: Actor,
    input: z.output<typeof RevealPhoneInput>,
  ): Promise<RevealedPhone> {
    const phone = await this.identity.phoneForCall(
      input.personId,
      actor.personId,
      CONSOLE_PHONE_REVEAL_PURPOSE,
    );
    if (phone === null) throw new DriverError('not_found');
    await this.audits?.record({
      cityId: null,
      actorId: actor.personId,
      action: 'people.phone_reveal',
      subjectKind: 'person',
      subjectId: input.personId,
      summaryAr: 'كشف الرقم الكامل',
      detail: { reason: input.reason },
    });
    return { phone, at: this.clock.now() };
  }
}

function storyItem(p: Partial<StoryItem> & Pick<StoryItem, 'id' | 'at' | 'kind'>): StoryItem {
  return {
    orderId: null,
    orderType: null,
    state: null,
    merchantOrgId: null,
    amountIqd: null,
    label: null,
    ticketId: null,
    ticketStatus: null,
    score: null,
    ...p,
  };
}

function profileTicket(t: TicketRecord): ProfileTicket {
  return {
    id: t.id,
    subject: t.subject,
    kind: t.kind,
    status: t.status,
    openedAt: t.openedAt,
    orderId: t.orderId,
    refundedIqd: t.refundedIqd,
  };
}

/** One label per customer, the first that fits (see `CustomerSegment`). */
export function segmentOf(p: {
  frozen: boolean;
  openTickets: number;
  joinedAt: Date;
  stats: CustomerStats | undefined;
  now: Date;
}): CustomerSegment {
  const age = p.now.getTime() - p.joinedAt.getTime();
  if (p.frozen) return 'frozen';
  if (p.openTickets > 0) return 'issue';
  if (age <= NEW_DAYS * DAY_MS) return 'new';
  const s = p.stats;
  if (s && s.delivered30d >= REGULAR_DELIVERED_30D) return 'regular';
  if (s && s.orders30d > 0) return 'active';
  if (s && s.orders > 0) return 'lapsed';
  return 'quiet';
}

/** Median days between consecutive orders (times sorted ascending); null under three orders. */
export function medianGapDays(times: readonly number[]): number | null {
  if (times.length < 3) return null;
  const gaps = times
    .slice(1)
    .map((t, i) => (t - times[i]!) / DAY_MS)
    .sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const m = gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.round(m * 10) / 10;
}

/** The facts the profile's «شنو لازم تعرف» box says, most useful first, at most five. */
export function customerSignals(p: {
  segment: CustomerSegment;
  totals: CustomerProfile['totals'];
  hours: readonly number[];
  credits30dIqd: number;
  creditCount: number;
  lateRecent: number;
  openTickets: number;
  ratingAvg: number | null;
  ratingCount: number;
  frozen: boolean;
  now: Date;
}): ProfileSignal[] {
  const out: ProfileSignal[] = [];
  const sig = (s: Omit<ProfileSignal, 'n' | 'iqd'> & Partial<Pick<ProfileSignal, 'n' | 'iqd'>>) =>
    out.push({ n: null, iqd: null, ...s });
  if (p.frozen) sig({ key: 'frozen', tone: 'bad' });
  if (p.openTickets > 0) sig({ key: 'open_ticket', tone: 'bad', n: p.openTickets });
  if (p.lateRecent > 0) sig({ key: 'late_orders', tone: 'warn', n: p.lateRecent });
  if (p.credits30dIqd > 0)
    sig({ key: 'credits', tone: 'warn', n: p.creditCount, iqd: p.credits30dIqd });
  if (p.totals.orders >= 5 && p.totals.cancelled / p.totals.orders >= 0.2)
    sig({
      key: 'cancels_high',
      tone: 'warn',
      n: Math.round((p.totals.cancelled / p.totals.orders) * 100),
    });
  if (p.segment === 'lapsed' && p.totals.lastOrderAt)
    sig({
      key: 'lapsed',
      tone: 'info',
      n: Math.floor((p.now.getTime() - p.totals.lastOrderAt.getTime()) / DAY_MS),
    });
  if (p.segment === 'new') sig({ key: 'new_customer', tone: 'info' });
  if (p.ratingAvg !== null && p.ratingCount >= 3)
    sig(
      p.ratingAvg >= 4.5
        ? { key: 'rates_well', tone: 'good', n: Math.round(p.ratingAvg * 10) }
        : p.ratingAvg < 3.5
          ? { key: 'rates_low', tone: 'warn', n: Math.round(p.ratingAvg * 10) }
          : { key: 'rates_well', tone: 'info', n: Math.round(p.ratingAvg * 10) },
    );
  const total = p.hours.reduce((a, b) => a + b, 0);
  if (total >= 4) {
    const peak = p.hours.indexOf(Math.max(...p.hours));
    sig({ key: 'peak_hour', tone: 'info', n: peak });
  }
  return out.slice(0, 5);
}
