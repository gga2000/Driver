import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  type Actor,
  type BoardCourier,
  type BoardOrder,
  type LatLng,
  type MerchantBoard,
  type MerchantOrgInput,
  type MerchantPort,
  type MerchantStore,
  type Order,
  type RoleKind,
  type SetBusyInput,
  type SetPrinterStatusInput,
  type SetStoreOpenInput,
  type StoreStatusView,
  type Trip,
  type VehicleClass,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { activePauseWindow, CITY_PAUSE_WINDOWS, DEFAULT_TIMEZONE, ORDERS_RULES } from '../orders/index.js';
import type { MerchantSettings, Org } from '../orgs/index.js';
import { courierView, sortBoard, toBoardOrder } from './board.js';
import { busyUntilFor, toStoreStatus } from './status.js';

/**
 * The slices of other modules' public services the Merchant app's reads and switches need. Typed
 * narrowly so the service is tested with plain fakes and it is obvious what it can see.
 */
export interface MerchantOrdersPort {
  listActive(filter: { merchantOrgId: string }): Promise<Order[]>;
}
export interface MerchantTripsPort {
  activeForOrder(orderId: string): Promise<Trip | null>;
  lastPosition(tripId: string): Promise<{ pin: LatLng } | null>;
}
export interface MerchantPeoplePort {
  /** The person's live role grants with their org scope. */
  grants(personId: string): Promise<Array<{ kind: RoleKind; orgId: string | null; frozen: boolean }>>;
  hasRole(personId: string, kind: RoleKind, orgId?: string): Promise<boolean>;
  /** First name only, read from the vault and logged (purpose `courier_card`). */
  courierFirstName(courierId: string, accessorId: string): Promise<string | null>;
  courierVehicle(courierId: string, vehicleId: string | null): Promise<VehicleClass | null>;
}
export interface MerchantStoresPort {
  /** Throws `org_not_found` for an unknown org. */
  get(orgId: string): Promise<Org>;
  merchantSettings(orgId: string): Promise<MerchantSettings>;
  setMerchantSettings(orgId: string, patch: Partial<Omit<MerchantSettings, 'lastHeartbeatAt'>>): Promise<MerchantSettings>;
}
export interface MerchantCatalogPort {
  itemNames(orgId: string, itemIds: readonly string[]): Promise<Map<string, string>>;
}
/** Records the store's switches on its event stream (`merchant:<orgId>`). */
export interface MerchantEventsPort {
  record(type: string, actorId: string, merchantOrgId: string, payload: Record<string, unknown>): Promise<void>;
}

export const MERCHANT_ORDERS = Symbol('MERCHANT_ORDERS');
export const MERCHANT_TRIPS = Symbol('MERCHANT_TRIPS');
export const MERCHANT_PEOPLE = Symbol('MERCHANT_PEOPLE');
export const MERCHANT_STORES = Symbol('MERCHANT_STORES');
export const MERCHANT_CATALOG = Symbol('MERCHANT_CATALOG');
export const MERCHANT_EVENTS = Symbol('MERCHANT_EVENTS');

const OWNER: RoleKind = 'merchant_owner';
const STAFF: RoleKind = 'merchant_staff';
const CARD_CACHE_MAX = 2000;

/**
 * Driver Merchant reads and store switches (`merchant.*`). Every call is scoped: the actor must hold
 * a merchant role on that very store (owner or staff). Order actions stay on `orders.merchant.*`.
 */
@Injectable()
export class MerchantService implements MerchantPort {
  /** Courier first names per trip and reader: a board polled every few seconds logs one vault read per trip. */
  private readonly names = new Map<string, string | null>();

  constructor(
    @Inject(MERCHANT_ORDERS) private readonly orders: MerchantOrdersPort,
    @Inject(MERCHANT_TRIPS) private readonly trips: MerchantTripsPort,
    @Inject(MERCHANT_PEOPLE) private readonly people: MerchantPeoplePort,
    @Inject(MERCHANT_STORES) private readonly stores: MerchantStoresPort,
    @Inject(MERCHANT_CATALOG) private readonly catalog: MerchantCatalogPort,
    @Inject(MERCHANT_EVENTS) private readonly events: MerchantEventsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async myStores(actor: Actor): Promise<MerchantStore[]> {
    const grants = (await this.people.grants(actor.personId)).filter((g) => (g.kind === OWNER || g.kind === STAFF) && g.orgId && !g.frozen);
    const byOrg = new Map<string, MerchantStore>();
    for (const g of grants) {
      let org: Org;
      try {
        org = await this.stores.get(g.orgId!);
      } catch {
        continue; // a grant on an org this process doesn't know (deleted, other city): not a store to show
      }
      if (org.type !== 'restaurant' && org.type !== 'grocer') continue;
      const role = g.kind === OWNER || byOrg.get(org.id)?.role === 'owner' ? 'owner' : 'staff';
      byOrg.set(org.id, { orgId: org.id, name: org.name, type: org.type, cityId: org.cityId, role });
    }
    return [...byOrg.values()].sort((a, b) => a.name.localeCompare(b.name, 'ar') || a.orgId.localeCompare(b.orgId));
  }

  async board(actor: Actor, input: MerchantOrgInput): Promise<MerchantBoard> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const now = this.clock.now();
    const kitchen = (await this.stores.merchantSettings(org.id)).location?.pin ?? null;
    const live = await this.orders.listActive({ merchantOrgId: org.id });
    const itemIds = [...new Set(live.flatMap((o) => o.lines.map((l) => l.catalogItemId)).filter((id): id is string => id !== null))];
    const names = itemIds.length > 0 ? await this.catalog.itemNames(org.id, itemIds) : new Map<string, string>();
    const cards: BoardOrder[] = [];
    for (const order of live) {
      const courier = await this.courierOf(order, kitchen, actor.personId);
      const card = toBoardOrder({ order, itemNames: names, courier, acceptWindowSec: ORDERS_RULES.merchantAcceptSec, now });
      if (card) cards.push(card);
    }
    return { merchantOrgId: org.id, now, acceptWindowSec: ORDERS_RULES.merchantAcceptSec, orders: sortBoard(cards) };
  }

  async storeStatus(actor: Actor, input: MerchantOrgInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    return this.status(org);
  }

  async setOpen(actor: Actor, input: SetStoreOpenInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const now = this.clock.now();
    if (input.open) {
      await this.stores.setMerchantSettings(org.id, { closed: null });
      await this.events.record('merchant.opened', actor.personId, org.id, { at: now.toISOString() });
    } else {
      const closed = { reason: input.reason ?? 'other', note: input.note?.trim() || null, at: now };
      await this.stores.setMerchantSettings(org.id, { closed });
      await this.events.record('merchant.closed_early', actor.personId, org.id, { reason: closed.reason, note: closed.note, at: now.toISOString() });
    }
    return this.status(org);
  }

  async setBusy(actor: Actor, input: SetBusyInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const now = this.clock.now();
    const busyUntil = busyUntilFor(input.on, now);
    await this.stores.setMerchantSettings(org.id, { busyUntil });
    await this.events.record(input.on ? 'merchant.busy_on' : 'merchant.busy_off', actor.personId, org.id, { until: busyUntil?.toISOString() ?? null });
    return this.status(org);
  }

  async setPrinterStatus(actor: Actor, input: SetPrinterStatusInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const before = (await this.stores.merchantSettings(org.id)).printer ?? null;
    const now = this.clock.now();
    const name = input.name?.trim() || before?.name || null;
    await this.stores.setMerchantSettings(org.id, { printer: { state: input.state, name, at: now } });
    // Only a change is worth an event (the tablet reports on every check).
    if (before?.state !== input.state) await this.events.record('merchant.printer_status', actor.personId, org.id, { state: input.state, name });
    return this.status(org);
  }

  // ───────────────────────── internals ─────────────────────────

  private async status(org: Org): Promise<StoreStatusView> {
    const now = this.clock.now();
    const s = await this.stores.merchantSettings(org.id);
    const windows = s.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])];
    const pause = activePauseWindow(now, windows, DEFAULT_TIMEZONE);
    return toStoreStatus({
      merchantOrgId: org.id,
      name: org.name,
      now,
      busyUntil: s.busyUntil ?? null,
      closed: s.closed ?? null,
      printer: s.printer ?? null,
      pause,
      lastHeartbeatAt: s.lastHeartbeatAt,
      defaultPrepMinutes: s.defaultPrepMin ?? ORDERS_RULES.defaultPrepMin,
    });
  }

  private async courierOf(order: Order, kitchen: LatLng | null, readerId: string): Promise<BoardCourier> {
    const nobody = { position: null, kitchen, firstName: null, vehicleClass: null };
    // Only accepted orders get a courier (dispatch starts on `order.accepted`).
    if (order.state === 'placed') return courierView(order.id, { trip: null, ...nobody });
    const trip = await this.trips.activeForOrder(order.id);
    // Accepted and no trip yet: dispatch is about to look for one.
    if (!trip) return courierView(order.id, { trip: { state: 'created', courierId: null, stops: [] }, ...nobody });
    let firstName: string | null = null;
    let vehicleClass: VehicleClass | null = null;
    let position: LatLng | null = null;
    if (trip.courierId) {
      const key = `${trip.id}:${trip.courierId}:${readerId}`;
      if (!this.names.has(key)) {
        if (this.names.size >= CARD_CACHE_MAX) this.names.delete(this.names.keys().next().value!);
        this.names.set(key, await this.people.courierFirstName(trip.courierId, readerId));
      }
      firstName = this.names.get(key) ?? null;
      vehicleClass = await this.people.courierVehicle(trip.courierId, trip.vehicleId ?? null);
      position = (await this.trips.lastPosition(trip.id))?.pin ?? null;
    }
    return courierView(order.id, { trip, position, kitchen, firstName, vehicleClass });
  }

  /** The actor works at this store (owner or staff), and it is a restaurant or grocer. */
  private async assertStore(actor: Actor, merchantOrgId: string): Promise<Org> {
    if (!(await this.people.hasRole(actor.personId, OWNER, merchantOrgId)) && !(await this.people.hasRole(actor.personId, STAFF, merchantOrgId))) {
      throw new DriverError('forbidden');
    }
    let org: Org;
    try {
      org = await this.stores.get(merchantOrgId);
    } catch {
      throw new DriverError('org_not_found');
    }
    if (org.type !== 'restaurant' && org.type !== 'grocer') throw new DriverError('org_not_found');
    return org;
  }
}
