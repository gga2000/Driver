import { Inject, Injectable } from '@nestjs/common';
import {
  consoleItemKey,
  RosterRole,
  type ConsoleNames,
  type ConsoleNamesInput,
  type ConsolePort,
  type DriverPin,
  type DriverPositions,
  type DriverRosterRow,
  type DriversListInput,
  type DriversPage,
  type EventLogEntry,
  type MerchantRow,
  type OrderSearchInput,
  type OrderSearchPage,
  type OutboxView,
  type RightNow,
  type SimulatorStartInput,
  type SimulatorStatus,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { CatalogService } from '../catalog/index.js';
import { DispatchService, type LiveDriver } from '../dispatch/index.js';
import { EventsService, type StoredEvent } from '../events/index.js';
import { FleetService } from '../fleet/index.js';
import { IdentityService, type RosterRow } from '../identity/index.js';
import { CapsService, LedgerService, MerchantCashService } from '../ledger/index.js';
import { OrdersService } from '../orders/index.js';
import { OrgsService } from '../orgs/index.js';
import { ScoringService } from '../scoring/index.js';
import { SimulatorService } from '../simulator/index.js';
import { cashHeld, hourBefore, pinState } from './driver-state.js';

/** Failed outbox rows shown on the system page. */
export const RECENT_FAILED_OUTBOX = 20;
/** Vault-access purpose of the Console's display-name reads (K-01). */
export const CONSOLE_NAMES_PURPOSE = 'console_names';

/**
 * The Console's read side (`ctx.console`). Every view is composed from the owning modules' public
 * services — presence and the board from dispatch, grants from identity's roster port, cash and
 * caps from the ledger, history from orders, logs and outbox health from events — never from
 * another module's tables. Authorization happens in the routers.
 */
@Injectable()
export class ConsoleReadService implements ConsolePort {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly identity: IdentityService,
    private readonly orders: OrdersService,
    private readonly caps: CapsService,
    private readonly ledger: LedgerService,
    private readonly merchantCash: MerchantCashService,
    private readonly events: EventsService,
    private readonly orgs: OrgsService,
    private readonly scoring: ScoringService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly simulator: SimulatorService,
    private readonly fleet: FleetService,
    private readonly catalog: CatalogService,
  ) {}

  // ───────────────────────── names (K-01) ─────────────────────────

  /**
   * People, merchants and dishes by name for one Console page, in one call: display names through
   * identity's batched, logged vault read (the staff member is the accessor, one log row per person
   * read; deleted people are marked and not read), the registry vehicle (class and plate) each
   * driver is the active driver of, merchant names from orgs and dish names from each merchant's
   * catalog. Unknown ids are left out. `system…` actors are not people and are skipped.
   */
  async names(input: z.infer<typeof ConsoleNamesInput>, accessorId: string): Promise<ConsoleNames> {
    const personIds = [...new Set(input.personIds)].filter((id) => !id.startsWith('system'));
    const orgIds = [...new Set(input.orgIds)];
    const itemsByOrg = new Map<string, Set<string>>();
    for (const { orgId, itemId } of input.items) itemsByOrg.set(orgId, (itemsByOrg.get(orgId) ?? new Set()).add(itemId));

    const [display, vehicles, orgs, items] = await Promise.all([
      this.identity.displayNamesFor(personIds, accessorId, CONSOLE_NAMES_PURPOSE),
      this.fleet.activeVehiclesOf(personIds),
      Promise.all(orgIds.map((id) => this.orgs.find(id))),
      Promise.all([...itemsByOrg].map(async ([orgId, ids]) => ({ orgId, rows: await this.catalog.itemsOf(orgId, [...ids]) }))),
    ]);

    const out: ConsoleNames = { people: {}, orgs: {}, items: {} };
    for (const [id, d] of Object.entries(display)) {
      const v = d.deleted ? undefined : vehicles.get(id);
      out.people[id] = { displayName: d.displayName, deleted: d.deleted, vehicleClass: v?.vehicleClass ?? null, plate: v?.plate ?? null };
    }
    for (const org of orgs) if (org) out.orgs[org.id] = { name: org.name, type: org.type };
    for (const { orgId, rows } of items) for (const item of rows) out.items[consoleItemKey(orgId, item.id)] = { name: item.nameAr };
    return out;
  }

  // ───────────────────────── map ─────────────────────────

  async driverPositions(cityId: string): Promise<DriverPositions> {
    const now = this.clock.now();
    const live = await this.dispatch.liveDrivers(cityId, now);
    return { cityId, at: now, drivers: await Promise.all(live.map((d) => this.pin(d))) };
  }

  private async pin(d: LiveDriver): Promise<DriverPin> {
    const p = d.presence;
    const cap = await this.caps.status(p.driverId);
    return {
      driverId: p.driverId,
      cityId: p.cityId,
      lat: p.lat,
      lng: p.lng,
      heading: null,
      state: pinState(d.state, cap.overCap),
      vehicleClass: p.vehicle,
      tier: p.tier,
      zoneId: p.zoneId,
      lastSeenAt: new Date(p.lastSeenAt),
      cashHeldIqd: cashHeld(cap.cashIqd),
      owedIqd: cap.owedIqd,
      capIqd: cap.capIqd,
      overCap: cap.overCap,
      tripId: d.tripId,
    };
  }

  // ───────────────────────── roster ─────────────────────────

  async driversList(input: z.infer<typeof DriversListInput>): Promise<DriversPage> {
    const now = this.clock.now();
    const kinds = input.filter.role ? [input.filter.role] : RosterRole.options;
    const live = new Map((await this.dispatch.liveDrivers(input.cityId, now)).map((d) => [d.presence.driverId, d]));

    let page: { rows: RosterRow[]; nextCursor: string | null; total: number };
    if (input.filter.presence === 'online') {
      // Presence first: the online set is small; page it by person id like the roster does.
      const q = input.filter.q?.toLowerCase();
      const entries = [];
      for (const id of [...live.keys()].sort()) {
        if (q && !id.toLowerCase().includes(q)) continue;
        const entry = await this.identity.rosterEntry(id, kinds);
        if (entry) entries.push(entry);
      }
      const after = entries.filter((e) => input.cursor === undefined || e.personId > input.cursor);
      const rows = after.slice(0, input.limit);
      page = { rows, nextCursor: after.length > input.limit ? (rows.at(-1)?.personId ?? null) : null, total: entries.length };
    } else {
      page = await this.identity.roster({ kinds, cursor: input.cursor, limit: input.limit, q: input.filter.q });
      if (input.filter.presence === 'offline') page = { ...page, rows: page.rows.filter((r) => !live.has(r.personId)) };
    }

    const rows = await Promise.all(page.rows.map((r) => this.rosterRow(r, live.get(r.personId), now)));
    return { rows, nextCursor: page.nextCursor, total: page.total };
  }

  private async rosterRow(r: RosterRow, d: LiveDriver | undefined, now: Date): Promise<DriverRosterRow> {
    const [card, cap] = await Promise.all([this.scoring.scorecard(r.personId, r.joinedAt, now), d ? this.caps.status(r.personId) : Promise.resolve(null)]);
    return {
      personId: r.personId,
      roles: r.roles.filter((k): k is DriverRosterRow['roles'][number] => (RosterRole.options as readonly string[]).includes(k)),
      frozen: r.frozen,
      trustTier: r.trustTier,
      joinedAt: r.joinedAt,
      online: d !== undefined,
      state: d ? pinState(d.state, cap?.overCap ?? false) : null,
      vehicleClass: d?.presence.vehicle ?? null,
      zoneId: d?.presence.zoneId ?? null,
      lastSeenAt: d ? new Date(d.presence.lastSeenAt) : null,
      tripId: d?.tripId ?? null,
      tier: card.tier,
      scoreIndex: card.index,
      observation: card.observation,
    };
  }

  // ───────────────────────── orders ─────────────────────────

  searchOrders(input: z.infer<typeof OrderSearchInput>): Promise<OrderSearchPage> {
    return this.orders.search(input);
  }

  async orderEvents(orderId: string): Promise<EventLogEntry[]> {
    return (await this.events.forOrder(orderId)).map(toLogEntry);
  }

  async tripEvents(tripId: string): Promise<EventLogEntry[]> {
    return (await this.events.forTrip(tripId)).map(toLogEntry);
  }

  // ───────────────────────── right now ─────────────────────────

  async rightNow(cityId: string): Promise<RightNow> {
    const now = this.clock.now();
    const [orders, live, accept, cash, outbox] = await Promise.all([
      this.orders.liveStats(cityId),
      this.dispatch.liveDrivers(cityId, now),
      this.dispatch.acceptStats(hourBefore(now)),
      this.ledger.cashInField(),
      this.events.outboxStats(),
    ]);
    return {
      cityId,
      at: now,
      ordersLastHour: orders.ordersLastHour,
      activeOrders: orders.activeOrders,
      lateOrders: orders.lateOrders,
      activeDrivers: live.filter((d) => d.state !== 'offline_recent').length,
      avgTimeToAcceptSec: accept.avgSec,
      cashInFieldIqd: cash.totalIqd,
      outbox: { pending: outbox.pending, failed: outbox.failed },
    };
  }

  // ───────────────────────── system ─────────────────────────

  async outbox(): Promise<OutboxView> {
    const [stats, recentFailed] = await Promise.all([this.events.outboxStats(), this.events.recentFailedOutbox(RECENT_FAILED_OUTBOX)]);
    return { ...stats, recentFailed };
  }

  /** Live simulator (plan Step 7): progress while running, and the latest run's report summary. */
  async simulatorStatus(): Promise<z.input<typeof SimulatorStatus>> {
    return this.simulator.status();
  }

  /** Starts the simulator against this running API at `speed`× (default 60×): real presence, moving drivers. */
  async simulatorStart(input: z.infer<typeof SimulatorStartInput>): Promise<z.input<typeof SimulatorStatus>> {
    return this.simulator.start(input);
  }

  async simulatorStop(): Promise<z.input<typeof SimulatorStatus>> {
    return this.simulator.stop();
  }

  // ───────────────────────── merchants ─────────────────────────

  async merchants(cityId: string): Promise<MerchantRow[]> {
    const orgs = await this.orgs.merchants(cityId);
    return Promise.all(
      orgs.map(async (o) => {
        const b = await this.merchantCash.balance(o.id);
        return {
          merchantId: o.id,
          name: o.name,
          type: o.type,
          cityId: o.cityId,
          balanceIqd: b.balanceIqd,
          mode: b.mode,
          exposureCapIqd: b.exposureCapIqd,
          overExposure: b.overExposure,
          lastHeartbeatAt: o.lastHeartbeatAt,
        };
      }),
    );
  }
}

/** The stored event as the Console reads it; quarantine and skew marks are kept. */
export function toLogEntry(e: StoredEvent): EventLogEntry {
  return {
    id: e.id,
    actorId: e.actorId,
    type: e.type,
    occurredAt: e.occurredAt,
    recordedAt: e.recordedAt,
    ...(e.location ? { location: e.location } : {}),
    ...(e.tripId ? { tripId: e.tripId } : {}),
    ...(e.orderId ? { orderId: e.orderId } : {}),
    payload: e.payload,
    ...(e.idempotencyKey ? { idempotencyKey: e.idempotencyKey } : {}),
    ...(e.deviceUptimeMs !== undefined ? { deviceUptimeMs: e.deviceUptimeMs } : {}),
    aggregate: e.aggregate,
    aggregateId: e.aggregateId,
    skewMs: e.skewMs,
    flagged: e.flagged,
    ...(e.flagReason ? { flagReason: e.flagReason } : {}),
    quarantined: e.quarantined,
    ...(e.quarantineReason ? { quarantineReason: e.quarantineReason } : {}),
  };
}
