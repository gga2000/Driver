import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  DELIVERY_AREA_CACHE_MS,
  DRINKS_DEFAULT_PREP_MIN,
  DriverError,
  type DishKind,
  doorsOfTags,
  prepKindOf,
  daysFromWindows,
  localClock,
  scheduleState,
  storeHoursProblems,
  upcomingHolidays,
  windowsFromDays,
  type Actor,
  type BoardCourier,
  type BoardOrder,
  type LatLng,
  type MerchantBoard,
  type MerchantCustomerZones,
  type MerchantDeliveryArea,
  type MerchantOrgInput,
  type MerchantPort,
  type MerchantStore,
  type MissedSummary,
  type Order,
  type PartnerPickupSpot,
  type PrepKind,
  type PickupSpotPhoto,
  type PickupSpotView,
  type RoleKind,
  type SetBusyInput,
  type SetPickupSpotInput,
  type SetPrinterStatusInput,
  type SetStoreHoursInput,
  type SetStoreOpenInput,
  type StoreHoursView,
  type StoreStatusView,
  type Trip,
  type VehicleClass,
  type WeeklyWindow,
  type ZonePlacementView,
} from '@driver/contracts';
import { pickupCodeFor } from '../../shared/pickup-code.js';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { activePauseWindow, CITY_PAUSE_WINDOWS, DEFAULT_TIMEZONE, ORDERS_RULES } from '../orders/index.js';
import { closedNow, type MerchantPickupSpot, type MerchantSettings, type Org } from '../orgs/index.js';
import { courierMaySeePlaceDetails } from '../places/index.js';
import { EtaService } from '../routing/index.js';
import { composeCustomerZones, composeDeliveryArea } from './area.js';
import { courierView, radarOf, missedSummary, sortBoard, toBoardOrder } from './board.js';
import { busyExtraFor, busyUntilFor, toStoreStatus } from './status.js';

/**
 * The slices of other modules' public services the Merchant app's reads and switches need. Typed
 * narrowly so the service is tested with plain fakes and it is obvious what it can see.
 */
export interface MerchantOrdersPort {
  listActive(filter: { merchantOrgId: string }): Promise<Order[]>;
  /** The store's orders placed in `[from, to)` — today's misses for the board (M-01). Optional for fakes. */
  merchantOrders?(merchantOrgId: string, range: { from: Date; to: Date }): Promise<Order[]>;
  /** Perf z5: only the store's orders placed in `[from, to)` that it missed. Fakes may leave it out (then `merchantOrders`). */
  merchantMissedOrders?(merchantOrgId: string, range: { from: Date; to: Date }): Promise<Order[]>;
  /** Delivered orders placed in `[from, to)` per drop-off zone: counts only (maps program r6). */
  deliveredByDropoffZone(merchantOrgId: string, range: { from: Date; to: Date }): Promise<Array<{ zoneKey: string | null; orders: number }>>;
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
  /** His vehicle class and plate (the counter tells couriers apart by it, S-M4). */
  courierVehicle(courierId: string, vehicleId: string | null): Promise<{ vehicleClass: VehicleClass; plate: string | null } | null>;
}
export interface MerchantStoresPort {
  /** Throws `org_not_found` for an unknown org. */
  get(orgId: string): Promise<Org>;
  merchantSettings(orgId: string): Promise<MerchantSettings>;
  setMerchantSettings(orgId: string, patch: Partial<Omit<MerchantSettings, 'lastHeartbeatAt'>>): Promise<MerchantSettings>;
}
export interface MerchantCatalogPort {
  itemNames(orgId: string, itemIds: readonly string[]): Promise<Map<string, string>>;
  /** k4/j6: the owner's ticket kinds for these dishes (only the ones he set). */
  itemKinds?(orgId: string, itemIds: readonly string[]): Promise<Map<string, DishKind>>;
  /** The customer storefront's weekly hours (the onboarding seed); null when the store has none. */
  storefrontHours?(orgId: string): Promise<WeeklyWindow[] | null>;
  /** The customer storefront's tags (what it sells, for shops from before «شنو تبيع؟»); null without one. */
  storefrontTags?(orgId: string): Promise<string[] | null>;
  /** Writes the store's own weekly hours onto its customer storefront (the card's open/closed). */
  mirrorHours?(orgId: string, windows: readonly WeeklyWindow[]): Promise<void>;
}
/** Records the store's switches on its event stream (`merchant:<orgId>`). */
export interface MerchantEventsPort {
  record(type: string, actorId: string, merchantOrgId: string, payload: Record<string, unknown>): Promise<void>;
}

/**
 * Pickup-spot photos (maps program r7): uploads in the places blob store. Reads are signed links, so
 * the photos never sit at a public URL; absent (fakes) = a spot with a note only.
 */
export interface MerchantPhotosPort {
  /** The upload is this person's and its bytes arrived (a stranger's upload id can't be attached). */
  owns(uploadId: string, personId: string): Promise<boolean>;
  readUrl(uploadId: string): string;
  remove(uploadId: string): Promise<void>;
}

/**
 * The delivery map's facts from other modules (maps program r5): the zones every app map draws,
 * checkout's fee quote, and the Console switches `orders.place` obeys — so the kitchen sees exactly
 * what its customers get.
 */
export interface MerchantAreaPort {
  /** The city's live zones with outlines (`ZonesService.list`). */
  zones(cityId: string): Promise<readonly ZonePlacementView[]>;
  /** Checkout's delivery fee for food from the kitchen's zone to `dropoffZone` at `at`; null when it cannot be priced. */
  foodDeliveryFee(cityId: string, kitchenZone: string, dropoffZone: string, at: Date): number | null;
  /** Of `zoneKeys`, those a Console switch closes to food from this store (zone, food service or the store itself). */
  pausedZones(cityId: string, merchantOrgId: string, kitchenZone: string, zoneKeys: readonly string[]): Promise<Set<string>>;
}

/**
 * «جهّز محلك» as the status header and the open switch see it (bound to `MerchantSetupService`):
 * the setup line on `storeStatus`, and opening a shop still in setup is going live.
 */
export interface MerchantSetupLinePort {
  statusLine(org: Org, s: MerchantSettings): Promise<StoreStatusView['setup']>;
  isInSetup(s: MerchantSettings): boolean;
  /** A new shop (no storefront yet, nothing set up) starts its setup the first time it is read. */
  adopt(org: Org): Promise<void>;
  goLive(actor: Actor, input: MerchantOrgInput): Promise<unknown>;
}

export const MERCHANT_SETUP_LINE = Symbol('MERCHANT_SETUP_LINE');
export const MERCHANT_ORDERS = Symbol('MERCHANT_ORDERS');
export const MERCHANT_AREA = Symbol('MERCHANT_AREA');
export const MERCHANT_TRIPS = Symbol('MERCHANT_TRIPS');
export const MERCHANT_PEOPLE = Symbol('MERCHANT_PEOPLE');
export const MERCHANT_STORES = Symbol('MERCHANT_STORES');
export const MERCHANT_CATALOG = Symbol('MERCHANT_CATALOG');
export const MERCHANT_EVENTS = Symbol('MERCHANT_EVENTS');
export const MERCHANT_PHOTOS = Symbol('MERCHANT_PHOTOS');

const OWNER: RoleKind = 'merchant_owner';
const STAFF: RoleKind = 'merchant_staff';
const CARD_CACHE_MAX = 2000;
/** Stores whose delivery map is kept (a town has a few hundred; the oldest goes first past this). */
const AREA_CACHE_MAX = 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Driver Merchant reads and store switches (`merchant.*`). Every call is scoped: the actor must hold
 * a merchant role on that very store (owner or staff). Order actions stay on `orders.merchant.*`.
 */
@Injectable()
export class MerchantService implements MerchantPort {
  /** Courier first names per trip and reader: a board polled every few seconds logs one vault read per trip. */
  private readonly names = new Map<string, string | null>();
  /** Delivery maps per store, with when they were priced (DELIVERY_AREA_CACHE_MS, same Baghdad hour). */
  private readonly areas = new Map<string, { at: number; view: MerchantDeliveryArea }>();

  constructor(
    @Inject(MERCHANT_ORDERS) private readonly orders: MerchantOrdersPort,
    @Inject(MERCHANT_TRIPS) private readonly trips: MerchantTripsPort,
    @Inject(MERCHANT_PEOPLE) private readonly people: MerchantPeoplePort,
    @Inject(MERCHANT_STORES) private readonly stores: MerchantStoresPort,
    @Inject(MERCHANT_CATALOG) private readonly catalog: MerchantCatalogPort,
    @Inject(MERCHANT_EVENTS) private readonly events: MerchantEventsPort,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly eta: EtaService,
    @Inject(MERCHANT_AREA) private readonly area: MerchantAreaPort,
    @Optional() @Inject(MERCHANT_PHOTOS) private readonly photos: MerchantPhotosPort | null = null,
    @Optional() @Inject(MERCHANT_SETUP_LINE) private readonly setup: MerchantSetupLinePort | null = null,
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
    const kinds = itemIds.length > 0 && this.catalog.itemKinds ? await this.catalog.itemKinds(org.id, itemIds) : new Map<string, DishKind>();
    const cards: BoardOrder[] = [];
    for (const order of live) {
      const courier = await this.courierOf(order, kitchen, actor.personId);
      const card = toBoardOrder({ order, itemNames: names, itemKinds: kinds, courier, acceptWindowSec: ORDERS_RULES.merchantAcceptSec, now });
      if (card) cards.push(card);
    }
    const missed = await this.missedToday(org, now);
    return { merchantOrgId: org.id, now, acceptWindowSec: ORDERS_RULES.merchantAcceptSec, orders: sortBoard(cards), ...(missed ? { missed } : {}) };
  }

  /** Orders that left today without the kitchen's answer (M-01): they never vanish silently. */
  private async missedToday(org: Org, now: Date): Promise<MissedSummary | null> {
    if (!this.orders.merchantOrders) return null;
    const local = localClock(now, DEFAULT_TIMEZONE);
    const from = new Date(Math.floor((now.getTime() - local.minutes * 60_000) / 60_000) * 60_000);
    const range = { from, to: new Date(now.getTime() + 1) };
    // Perf z5: read the day's misses only (a few rows), not every order of the day on every board read.
    const today = this.orders.merchantMissedOrders ? await this.orders.merchantMissedOrders(org.id, range) : await this.orders.merchantOrders(org.id, range);
    const s = await this.stores.merchantSettings(org.id);
    const pauses = s.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])];
    return missedSummary(today, (at) => activePauseWindow(at, pauses, DEFAULT_TIMEZONE) !== null);
  }

  async storeStatus(actor: Actor, input: MerchantOrgInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    return this.status(org);
  }

  async setOpen(actor: Actor, input: SetStoreOpenInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const now = this.clock.now();
    // «جهّز محلك»: a shop still in setup opens by going live (every step done; owner only), and a
    // close (a quick pause included) leaves setup's own close in place, so "not live" stays closed.
    if (this.setup?.isInSetup(await this.stores.merchantSettings(org.id))) {
      if (input.open) await this.setup.goLive(actor, { merchantOrgId: org.id });
      return this.status(org);
    }
    if (input.open) {
      await this.stores.setMerchantSettings(org.id, { closed: null });
      await this.events.record('merchant.opened', actor.personId, org.id, { at: now.toISOString() });
    } else {
      const until = input.pauseMinutes ? new Date(now.getTime() + input.pauseMinutes * 60_000) : null;
      const closed = { reason: input.reason ?? 'other', note: input.note?.trim() || null, at: now, until };
      await this.stores.setMerchantSettings(org.id, { closed });
      await this.events.record('merchant.closed_early', actor.personId, org.id, { reason: closed.reason, note: closed.note, at: now.toISOString(), ...(until ? { until: until.toISOString() } : {}) });
    }
    return this.status(org);
  }

  async setBusy(actor: Actor, input: SetBusyInput): Promise<StoreStatusView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const now = this.clock.now();
    const busyUntil = busyUntilFor(input.on, now);
    // r5 (Ali 2026-10-08): +10 or +20, still for the hour; the schema lets only 10 or 20 through.
    const busyExtraMin = input.on ? busyExtraFor(input.extraMinutes) : null;
    await this.stores.setMerchantSettings(org.id, { busyUntil, busyExtraMin });
    await this.events.record(input.on ? 'merchant.busy_on' : 'merchant.busy_off', actor.personId, org.id, { until: busyUntil?.toISOString() ?? null, ...(busyExtraMin !== null ? { extraMinutes: busyExtraMin } : {}) });
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

  // ───────────────────────── opening hours ─────────────────────────

  /** The weekly schedule, holiday closures and pause windows, and whether the store is open now. */
  async hours(actor: Actor, input: MerchantOrgInput): Promise<StoreHoursView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    return this.hoursView(org, await this.people.hasRole(actor.personId, OWNER, org.id));
  }

  /**
   * Owner only. Replaces the schedule (split shifts, past-midnight shifts) and the closures; the
   * customer storefront gets the same weekly hours, so cards and `orders.place` follow them, and a
   * holiday closes the store for orders like the early-close switch.
   */
  async setHours(actor: Actor, input: SetStoreHoursInput): Promise<StoreHoursView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    await this.assertOwner(actor, org.id);
    if (storeHoursProblems(input.days, input.holidays).length > 0)
      throw new DriverError('store_hours_invalid');
    const now = this.clock.now();
    const today = localClock(now, DEFAULT_TIMEZONE).date;
    const windows = windowsFromDays(input.days);
    const holidays = upcomingHolidays(
      input.holidays.map((h) => ({ from: h.from, to: h.to, note: h.note?.trim() || null })),
      today,
    );
    await this.stores.setMerchantSettings(org.id, {
      openingHours: windows,
      holidays,
      hoursUpdatedAt: now,
    });
    await this.catalog.mirrorHours?.(org.id, windows);
    await this.events.record('merchant.hours_set', actor.personId, org.id, {
      shifts: windows.length,
      openDays: new Set(windows.map((w) => w.dow)).size,
      holidays: holidays.map((h) => ({ from: h.from, to: h.to })),
    });
    return this.hoursView(org, true);
  }

  /** The store's own hours, else the storefront's seeded ones, else none (always open). */
  private async weeklyHours(
    orgId: string,
    s: MerchantSettings,
  ): Promise<{ windows: WeeklyWindow[]; source: StoreHoursView['source'] }> {
    if (s.openingHours) return { windows: s.openingHours, source: 'store' };
    const seeded = (await this.catalog.storefrontHours?.(orgId)) ?? [];
    return seeded.length > 0
      ? { windows: seeded, source: 'catalog' }
      : { windows: [], source: 'none' };
  }

  private async hoursView(org: Org, canEdit: boolean): Promise<StoreHoursView> {
    const now = this.clock.now();
    const s = await this.stores.merchantSettings(org.id);
    const { windows, source } = await this.weeklyHours(org.id, s);
    const local = localClock(now, DEFAULT_TIMEZONE);
    const holidays = upcomingHolidays(s.holidays ?? [], local.date);
    const pauses = s.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])];
    const pause = activePauseWindow(now, pauses, DEFAULT_TIMEZONE);
    const sched = scheduleState(now, windows, holidays, DEFAULT_TIMEZONE);
    const state: StoreHoursView['state'] = closedNow(s.closed, now)
      ? { open: false, reason: 'closed', closesAt: null, opensAt: null }
      : !sched.inHours
        ? {
            open: false,
            reason: sched.holiday ? 'holiday' : 'hours',
            closesAt: null,
            opensAt: sched.opensAt,
          }
        : pause
          ? {
              open: false,
              reason: 'pause',
              closesAt: null,
              opensAt: { date: local.date, dow: local.dow, time: pause.end },
            }
          : { open: true, reason: null, closesAt: sched.closesAt, opensAt: null };
    return {
      merchantOrgId: org.id,
      timeZone: DEFAULT_TIMEZONE,
      source,
      days: daysFromWindows(windows),
      holidays,
      pauses: pauses.map((p) => ({
        dow: p.dow,
        start: p.start,
        end: p.end,
        reason: p.reason ?? null,
      })),
      now,
      today: local.date,
      state,
      canEdit,
      updatedAt: s.hoursUpdatedAt ?? null,
    };
  }

  // ───────────────────────── pickup spot ─────────────────────────

  /** Where couriers collect orders (maps program r7): the note and photos; owners edit, staff read. */
  async pickupSpot(actor: Actor, input: MerchantOrgInput): Promise<PickupSpotView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const canEdit = await this.people.hasRole(actor.personId, OWNER, org.id);
    return this.pickupView(org.id, (await this.stores.merchantSettings(org.id)).pickupSpot ?? null, canEdit);
  }

  /**
   * Owner only. Replaces the spot: photos already on it stay; a new one must be his own stored upload
   * (a stranger's upload id can't be attached); photos left out are deleted, since nothing else
   * points at them. No note and no photos clears the spot, so couriers see no empty card.
   */
  async setPickupSpot(actor: Actor, input: SetPickupSpotInput): Promise<PickupSpotView> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    await this.assertOwner(actor, org.id);
    return this.replacePickupSpot(actor, org.id, input, 'merchant');
  }

  /**
   * Any store's pickup spot for the Console (`ops.pickupSpots.*`, Ali 2026-10-07): field ops set it
   * for owners who can't. The caller's router has already checked the Console role; there is no
   * store scope to check, only that it is a restaurant or grocer.
   */
  async consolePickupSpot(merchantOrgId: string): Promise<PickupSpotView> {
    const org = await this.storeOrg(merchantOrgId);
    return this.pickupView(org.id, (await this.stores.merchantSettings(org.id)).pickupSpot ?? null, true);
  }

  /**
   * The owner's save, made from the Console: the very same rules (photos the caller uploaded himself,
   * dropped photos deleted, an empty spot cleared) and the same `merchant.pickup_spot_set` event,
   * marked `by: 'console'`. The Console audit row is the caller's (ops module).
   */
  async consoleSetPickupSpot(actor: Actor, input: SetPickupSpotInput): Promise<PickupSpotView> {
    const org = await this.storeOrg(input.merchantOrgId);
    return this.replacePickupSpot(actor, org.id, input, 'console');
  }

  private async replacePickupSpot(actor: Actor, merchantOrgId: string, input: SetPickupSpotInput, by: 'merchant' | 'console'): Promise<PickupSpotView> {
    const before = (await this.stores.merchantSettings(merchantOrgId)).pickupSpot ?? null;
    const kept = new Set(before?.photoRefs ?? []);
    for (const id of input.photoIds) {
      if (kept.has(id)) continue;
      if (!this.photos || !(await this.photos.owns(id, actor.personId))) throw new DriverError('upload_invalid');
    }
    const note = input.note?.trim() || null;
    const spot: MerchantPickupSpot | null = note || input.photoIds.length > 0 ? { note, photoRefs: [...input.photoIds], updatedAt: this.clock.now() } : null;
    const saved = await this.stores.setMerchantSettings(merchantOrgId, { pickupSpot: spot });
    for (const old of before?.photoRefs ?? []) if (!input.photoIds.includes(old)) await this.photos?.remove(old);
    await this.events.record('merchant.pickup_spot_set', actor.personId, merchantOrgId, { photos: input.photoIds.length, note: note !== null, ...(by === 'console' ? { by } : {}) });
    return this.pickupView(merchantOrgId, saved.pickupSpot ?? null, true);
  }

  /**
   * The pickup spot as the courier on the job sees it: only the assigned courier, from accepting
   * until the trip is over — the rule the customer's door follows (`courierMaySeePlaceDetails`).
   * Whether the pickup is still to do is the job screen's call. Null when there is nothing to show.
   */
  async courierPickupSpot(merchantOrgId: string, input: Parameters<typeof courierMaySeePlaceDetails>[0]): Promise<PartnerPickupSpot | null> {
    if (!courierMaySeePlaceDetails(input)) return null;
    const spot = (await this.stores.merchantSettings(merchantOrgId)).pickupSpot ?? null;
    if (!spot) return null;
    const photos = this.signed(spot);
    return spot.note || photos.length > 0 ? { note: spot.note, photos } : null;
  }

  private pickupView(merchantOrgId: string, spot: MerchantPickupSpot | null, canEdit: boolean): PickupSpotView {
    return { merchantOrgId, note: spot?.note ?? null, photos: spot ? this.signed(spot) : [], canEdit, updatedAt: spot?.updatedAt ?? null };
  }

  /** Signed links for the spot's photos; none without a photo store. */
  private signed(spot: MerchantPickupSpot): PickupSpotPhoto[] {
    const photos = this.photos;
    return photos ? spot.photoRefs.map((id) => ({ id, url: photos.readUrl(id) })) : [];
  }

  // ───────────────────────── delivery area and customers' zones (maps r5, r6) ─────────────────────────

  /**
   * «منطقة التوصيل»: the zones and the fee a customer in each pays for this kitchen's food, read-only.
   * Fees come from checkout's own quote (never a client number, never a rule copied here). Kept per
   * store for DELIVERY_AREA_CACHE_MS and never past the Baghdad hour it was priced in (night fees
   * change on the hour), so a tablet polling the screen does not re-read zones and switches.
   */
  async deliveryArea(actor: Actor, input: MerchantOrgInput): Promise<MerchantDeliveryArea> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    const now = this.clock.now().getTime();
    const hit = this.areas.get(org.id);
    if (hit && now - hit.at >= 0 && now - hit.at < DELIVERY_AREA_CACHE_MS && Math.floor(hit.at / HOUR_MS) === Math.floor(now / HOUR_MS)) return hit.view;
    const at = new Date(now);
    const kitchen = (await this.stores.merchantSettings(org.id)).location ?? null;
    const zones = await this.area.zones(org.cityId);
    const paused = kitchen ? await this.area.pausedZones(org.cityId, org.id, kitchen.zoneKey, zones.map((z) => z.key)) : new Set<string>();
    const view = composeDeliveryArea({
      merchantOrgId: org.id,
      cityId: org.cityId,
      kitchen,
      zones,
      feeOf: (zoneKey) => (kitchen ? this.area.foodDeliveryFee(org.cityId, kitchen.zoneKey, zoneKey, at) : null),
      paused,
      at,
    });
    this.areas.delete(org.id);
    if (this.areas.size >= AREA_CACHE_MAX) this.areas.delete(this.areas.keys().next().value!);
    this.areas.set(org.id, { at: now, view });
    return view;
  }

  /**
   * «منين زبائنك»: the store's delivered orders over the last `days` per drop-off zone, from one grouped
   * read. Zones under CUSTOMER_ZONE_MIN_ORDERS are not named (D7). Owner only (Ali 2026-10-07): who
   * buys where is the business's own picture, kept like the money screens (staff get `forbidden`).
   */
  async customerZones(actor: Actor, input: { merchantOrgId: string; days: number }): Promise<MerchantCustomerZones> {
    const org = await this.assertStore(actor, input.merchantOrgId);
    await this.assertOwner(actor, org.id);
    const to = this.clock.now();
    const from = new Date(to.getTime() - input.days * DAY_MS);
    const [counts, zones] = await Promise.all([this.orders.deliveredByDropoffZone(org.id, { from, to: new Date(to.getTime() + 1) }), this.area.zones(org.cityId)]);
    return composeCustomerZones({ merchantOrgId: org.id, from, to, days: input.days, counts, zones });
  }

  // ───────────────────────── internals ─────────────────────────

  private async status(org: Org): Promise<StoreStatusView> {
    const now = this.clock.now();
    if (this.setup) await this.setup.adopt(org);
    const s = await this.stores.merchantSettings(org.id);
    const windows = s.pauseWindows ?? [...(CITY_PAUSE_WINDOWS[org.cityId] ?? [])];
    const pause = activePauseWindow(now, windows, DEFAULT_TIMEZONE);
    const { windows: weekly } = await this.weeklyHours(org.id, s);
    // A shop set up through «جهّز محلك» with no hours on file is closed, not open around the clock
    // (older shops keep reading no hours as always open).
    const sched = s.setup && weekly.length === 0 ? { inHours: false, holiday: null, closesAt: null, opensAt: null } : scheduleState(now, weekly, s.holidays ?? [], DEFAULT_TIMEZONE);
    const setup = this.setup ? await this.setup.statusLine(org, s) : null;
    const prepKind = await this.prepKind(org.id, s);
    return toStoreStatus({
      prepKind,
      busyExtraMin: s.busyExtraMin ?? null,
      setup,
      schedule: {
        inHours: sched.inHours,
        holiday: sched.holiday ? { to: sched.holiday.to, note: sched.holiday.note } : null,
        closesAt: sched.closesAt,
        opensAt: sched.opensAt,
      },
      merchantOrgId: org.id,
      name: org.name,
      now,
      busyUntil: s.busyUntil ?? null,
      closed: closedNow(s.closed, now),
      printer: s.printer ?? null,
      pause,
      lastHeartbeatAt: s.lastHeartbeatAt,
      defaultPrepMinutes: s.defaultPrepMin ?? (prepKind === 'drinks' ? DRINKS_DEFAULT_PREP_MIN : ORDERS_RULES.defaultPrepMin),
    });
  }

  /**
   * t5 (Ali 2026-10-08): juice bars and cafés pick 3 / 5 / 8 minutes. What the shop sells comes from
   * «شنو تبيع؟» when it went through setup, else from its storefront's tags; a shop with food as well,
   * or with nothing on file, is food.
   */
  private async prepKind(orgId: string, s: MerchantSettings): Promise<PrepKind> {
    if (s.setup?.kinds && s.setup.kinds.length > 0) return prepKindOf(s.setup.kinds);
    const tags = (await this.catalog.storefrontTags?.(orgId)) ?? [];
    return prepKindOf(doorsOfTags(tags));
  }

  private async courierOf(order: Order, kitchen: LatLng | null, readerId: string): Promise<BoardCourier> {
    const nobody = { firstName: null, vehicleClass: null, etaMinutes: null, plate: null };
    // Only accepted orders get a courier (dispatch starts on `order.accepted`).
    if (order.state === 'placed') return courierView(order.id, { trip: null, ...nobody });
    const trip = await this.trips.activeForOrder(order.id);
    // Accepted and no trip yet: dispatch is about to look for one.
    if (!trip) return courierView(order.id, { trip: { state: 'created', courierId: null, stops: [] }, ...nobody });
    let firstName: string | null = null;
    let vehicleClass: VehicleClass | null = null;
    let plate: string | null = null;
    let position: LatLng | null = null;
    if (trip.courierId) {
      const key = `${trip.id}:${trip.courierId}:${readerId}`;
      if (!this.names.has(key)) {
        if (this.names.size >= CARD_CACHE_MAX) this.names.delete(this.names.keys().next().value!);
        this.names.set(key, await this.people.courierFirstName(trip.courierId, readerId));
      }
      firstName = this.names.get(key) ?? null;
      const vehicle = await this.people.courierVehicle(trip.courierId, trip.vehicleId ?? null);
      vehicleClass = vehicle?.vehicleClass ?? null;
      plate = vehicle?.plate ?? null;
      position = (await this.trips.lastPosition(trip.id))?.pin ?? null;
    }
    const facts = { trip, firstName, vehicleClass, plate, etaMinutes: null, pickupCode: trip.courierId ? pickupCodeFor(order.id, trip.courierId) : null };
    const view = courierView(order.id, facts);
    if (view.state !== 'on_the_way' || !position || !kitchen) return view;
    // One ETA everywhere (maps program SP4b): the same service the customer's screen uses; the radar
    // (r1) from the same fix.
    const etaMinutes = (await this.eta.minutes(position, kitchen, vehicleClass ?? 'bike')).minutes;
    return courierView(order.id, { ...facts, etaMinutes, radar: radarOf(kitchen, position) });
  }

  /** Owner-only reads and writes (the money screens' rule): staff and strangers get `forbidden`. */
  private async assertOwner(actor: Actor, merchantOrgId: string): Promise<void> {
    if (!(await this.people.hasRole(actor.personId, OWNER, merchantOrgId))) throw new DriverError('forbidden');
  }

  /** The actor works at this store (owner or staff), and it is a restaurant or grocer. */
  private async assertStore(actor: Actor, merchantOrgId: string): Promise<Org> {
    if (!(await this.people.hasRole(actor.personId, OWNER, merchantOrgId)) && !(await this.people.hasRole(actor.personId, STAFF, merchantOrgId))) {
      throw new DriverError('forbidden');
    }
    return this.storeOrg(merchantOrgId);
  }

  /** The org, which must be a restaurant or grocer (`org_not_found` otherwise). */
  private async storeOrg(merchantOrgId: string): Promise<Org> {
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
