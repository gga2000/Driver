import { Inject, Injectable } from '@nestjs/common';
import {
  DriverError,
  QUIET_MAX_DAYS,
  Vertical,
  type Actor,
  type AuditEntry,
  type AuditInput,
  type BannerInput,
  type BannerSeverity,
  type ControlsPort,
  type ControlsView,
  type KillScope,
  type KillSwitchView,
  type PublicBanner,
  type PublicScreens,
  type PublicSeason,
  type QuietDaysView,
  ScreenSwitch,
  type ScreenAudience,
  type ScreenSwitchView,
  type ScreensInput,
  type SeasonInput,
  type SetBannerInput,
  type SetKillSwitchInput,
  type SetIftarTimeInput,
  type SetQuietDaysInput,
  type SetScreenSwitchInput,
  type SetSeasonInput,
  type SeasonView,
  type SetZoneCapacityInput,
  type SystemBannerView,
  type ZoneCapacityView,
  type ZoneLoadState,
} from '@driver/contracts';
import { formatClock, t } from '@driver/i18n';
import type { z } from 'zod';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { localDateKey } from '../../shared/local-time.js';
import { ConfigService } from '../config/index.js';
import { EventsService } from '../events/index.js';
import { OrgsService } from '../orgs/index.js';
import { AuditLogService, StaffNames } from './audit.js';
import { CONTROLS_REPOSITORY, QUIET_DEFAULTS, targetOf, type BannerRecord, type ControlsRepository, type KillSwitchRecord, type QuietRecord, type ZoneCapacityRecord } from './controls.repository.js';
import { SEASON_KIND_AR, TIMETABLE_AR, checkNewSeason, composeSeason, normalizeSeason, promoHold, seasonDays, withIftarOverride, type PromoHold } from './season.js';

/** Arabic names of the verticals, as the switches and refusals say them. */
export const VERTICAL_AR: Record<Vertical, string> = {
  food: 'الأكل',
  grocery: 'التسوّق',
  errand: 'اشتري لي',
  parcel: 'الطرود',
  taxi: 'التكسي',
  tuktuk: 'التكتك',
  intercity: 'الرجعة',
  khat: 'الخطوط',
};

/** Arabic names of the redesigned screens, as the Console and the audit log say them. */
export const SCREEN_AR: Record<ScreenSwitch, string> = {
  basket_v2: 'السلة',
  checkout_v2: 'الدفع',
  track_v2: 'متابعة الطلب',
  orders_v2: 'طلباتي',
};
const AUDIENCE_AR: Record<ScreenAudience, string> = { off: 'مطفّية', staff: 'للموظفين بس', all: 'لكل الزبائن' };
/** The two rows behind one screen switch: shown to staff, shown to everyone. */
const screenKey = (key: ScreenSwitch, who: 'staff' | 'all') => `ui.${key}@${who}`;

/** The default throttle wait: "جرّب بعد ربع ساعة". */
export const DEFAULT_THROTTLE_ETA_MIN = 15;
/** Busy from this share of the cap (amber gauge). */
export const BUSY_LOAD = 0.8;
/** A banner is a notice for today: it must end within this long of when it starts. */
export const BANNER_MAX_MS = 24 * 3_600_000;
/** Every open app polls `system.banner`; one read per instance per few seconds is plenty. */
const BANNER_CACHE_MS = 5_000;
const SWITCH_CACHE_MS = 2_000;
const RECENT_MS = 24 * 3_600_000;
const SEVERITY_RANK: Record<BannerSeverity, number> = { critical: 3, warning: 2, info: 1 };
const SEVERITY_AR: Record<BannerSeverity, string> = { critical: 'مهم جداً', warning: 'تنبيه', info: 'معلومة' };
/** `system.season` is polled by every open app, and the notify engine asks before each offer. */
const QUIET_CACHE_MS = 5_000;

/** Whole calendar days from one YYYY-MM-DD to another (date arithmetic in UTC; no time zone involved). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** What a placement asks the gate (orders.place, routes booking). */
export interface OrderGate {
  cityId: string;
  vertical: Vertical;
  /** Every zone the job touches (pickup, drop-off): a switched-off zone refuses it either way. */
  zones: ReadonlyArray<string | null | undefined>;
  /** The customer's zone: the one the throttle counts. */
  customerZone: string | null;
  merchantOrgId: string | null;
  /** A scheduled order at or after the throttle's wait passes in `queue` mode. */
  scheduledFor?: Date | null;
}

/** Active orders per customer zone, bound by the orders module (it owns the count). */
export type ActiveOrdersByZone = (cityId: string) => Promise<Map<string, number>>;

function quarterHour(etaMin: number): string {
  if (etaMin === 15) return t('console.wait_quarter');
  if (etaMin === 30) return t('console.wait_half');
  if (etaMin === 60) return t('console.wait_hour');
  return t('console.wait_min', { n: etaMin });
}

/** The honest refusal: "الطلبات هواية هسة بمنطقتك، جرّب بعد ربع ساعة" (queue mode offers the slot). */
export function throttleMessage(etaMin: number, mode: 'refuse' | 'queue'): string {
  return t(mode === 'queue' ? 'console.ctl_throttle_queue' : 'console.ctl_throttle_refuse', { wait: quarterHour(etaMin) });
}

/** "11:30 م" on the city's one clock (`formatClock` in packages/i18n). */
export function baghdadClock(d: Date): string {
  return formatClock(d);
}

export function loadState(maxActive: number | null, active: number, killed: boolean): { load: number; state: ZoneLoadState } {
  if (killed) return { load: maxActive ? active / maxActive : 0, state: 'off' };
  if (!maxActive) return { load: 0, state: 'ok' };
  const load = active / maxActive;
  return { load, state: active >= maxActive ? 'full' : load >= BUSY_LOAD ? 'busy' : 'ok' };
}

/**
 * Launch controls (playbook §3): kill switches per vertical, zone, restaurant and الرجعة corridor
 * (optionally holding automatic dispatch), the capacity throttle per zone, the status banner every
 * open app shows, and the console audit log. Enforcement is server-side: orders and routes call
 * `assertOrderAllowed` / `assertCorridorOpen` before they write, dispatch asks `dispatchHeld`.
 */
@Injectable()
export class ControlsService implements ControlsPort {
  private activeOrders: ActiveOrdersByZone = async () => new Map();
  private corridors: Array<{ id: string; name_ar: string }> = [];
  private readonly switchCache = new Map<string, { at: number; rows: KillSwitchRecord[] }>();
  private bannerCache: { at: number; rows: BannerRecord[] } | null = null;
  private quietCache: { at: number; rows: QuietRecord[] } | null = null;

  constructor(
    @Inject(CONTROLS_REPOSITORY) private readonly repo: ControlsRepository,
    private readonly config: ConfigService,
    private readonly orgs: OrgsService,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The orders module binds its live count (it owns orders; controls cannot import it). */
  bindActiveOrders(fn: ActiveOrdersByZone): void {
    this.activeOrders = fn;
  }

  /** The routes module registers its corridors (names for the console, keys for validation). */
  registerCorridors(list: ReadonlyArray<{ id: string; name_ar: string }>): void {
    this.corridors = list.map((c) => ({ id: c.id, name_ar: c.name_ar }));
  }

  // ───────────────────────── enforcement ─────────────────────────

  private async liveSwitches(cityId: string): Promise<KillSwitchRecord[]> {
    const now = this.clock.now().getTime();
    const hit = this.switchCache.get(cityId);
    let rows: KillSwitchRecord[];
    if (hit && now - hit.at >= 0 && now - hit.at < SWITCH_CACHE_MS) rows = hit.rows;
    else {
      rows = await this.repo.switches(cityId);
      this.switchCache.set(cityId, { at: now, rows });
    }
    return rows.filter((s) => s.active && (!s.expiresAt || s.expiresAt.getTime() > now));
  }

  private zoneName(cityId: string, zoneKey: string): string {
    return this.config.city(cityId)?.zones.find((z) => z.id === zoneKey)?.name_ar ?? zoneKey;
  }

  /** The switch that stops `gate`, if any: vertical first, then the restaurant, then a zone. */
  async blockingSwitch(gate: Omit<OrderGate, 'customerZone' | 'scheduledFor'>): Promise<KillSwitchRecord | null> {
    const live = await this.liveSwitches(gate.cityId);
    const zones = new Set(gate.zones.filter((z): z is string => Boolean(z)));
    return (
      live.find((s) => s.scope === 'vertical' && s.key === gate.vertical) ??
      live.find((s) => s.scope === 'restaurant' && gate.merchantOrgId !== null && s.key === gate.merchantOrgId) ??
      live.find((s) => s.scope === 'zone' && zones.has(s.key) && (s.vertical === null || s.vertical === gate.vertical)) ??
      null
    );
  }

  /**
   * REL-16: what menus and lists say about a kitchen a switch has stopped (the same words `place`
   * refuses with), or null when nothing stops it.
   */
  async stoppedNotice(gate: Omit<OrderGate, 'customerZone' | 'scheduledFor'>): Promise<string | null> {
    const s = await this.blockingSwitch(gate);
    return s ? this.refusalFor(s, gate.cityId) : null;
  }

  /**
   * The customer's refusal when the switch has no message of its own (UI/UX audit K-13): with an end
   * time it says when the service is back ("لحد الساعة 11:30 م"); never "إن شاء الله" in a time. The
   * Console sends its preview as `message_ar`, so this is the fallback for other callers.
   */
  private async refusalFor(s: KillSwitchRecord, cityId: string): Promise<string> {
    if (s.messageAr) return s.messageAr;
    // The same words the Console previews (console.ctl_refusal_*), so the preview is the refusal.
    const time = s.expiresAt ? baghdadClock(s.expiresAt) : null;
    const say = (scope: 'vertical' | 'zone' | 'restaurant' | 'corridor', name: string) =>
      time ? t(`console.ctl_refusal_${scope}_until`, { name, time }) : t(`console.ctl_refusal_${scope}`, { name });
    switch (s.scope) {
      case 'vertical':
        return say('vertical', VERTICAL_AR[s.key as Vertical] ?? s.key);
      case 'zone':
        return say('zone', this.zoneName(cityId, s.key));
      case 'restaurant': {
        const name = await this.orgs
          .get(s.key)
          .then((o) => o.name)
          .catch(() => t('restaurant.fallback_name'));
        return say('restaurant', name);
      }
      case 'corridor':
        return say('corridor', this.corridors.find((c) => c.id === s.key)?.name_ar ?? t('rajaa.fallback_corridor'));
      case 'screen':
        // Never reached: no gate matches a screen row. The vertical's words are the safe fallback.
        return say('vertical', s.key);
    }
  }

  /**
   * Refuses a new order the switches or the zone throttle stop: `service_paused` (with the
   * switch's own customer message when set) or `zone_at_capacity` (honest wait, `retryAfterSec`).
   */
  async assertOrderAllowed(gate: OrderGate): Promise<void> {
    const s = await this.blockingSwitch(gate);
    if (s) throw new DriverError('service_paused', { messageAr: await this.refusalFor(s, gate.cityId) });
    if (!gate.customerZone) return;
    const cap = (await this.repo.capacities(gate.cityId)).find((c) => c.zoneKey === gate.customerZone);
    if (!cap || cap.maxActive === null) return;
    const active = (await this.activeOrders(gate.cityId)).get(gate.customerZone) ?? 0;
    if (active < cap.maxActive) return;
    const now = this.clock.now().getTime();
    if (cap.mode === 'queue' && gate.scheduledFor && gate.scheduledFor.getTime() >= now + cap.etaMin * 60_000) return;
    throw new DriverError('zone_at_capacity', { retryAfterSec: cap.etaMin * 60, messageAr: throttleMessage(cap.etaMin, cap.mode) });
  }

  /** الرجعة booking: a switched-off corridor (or the intercity vertical) refuses new holds. */
  async assertCorridorOpen(input: { cityId: string; corridorId: string }): Promise<void> {
    const live = await this.liveSwitches(input.cityId);
    const s = live.find((x) => x.scope === 'vertical' && x.key === 'intercity') ?? live.find((x) => x.scope === 'corridor' && x.key === input.corridorId);
    if (s) throw new DriverError('service_paused', { messageAr: await this.refusalFor(s, input.cityId) });
  }

  /** Dispatch: a switch with `holdDispatch` turns automatic offers in its scope into suggest-only. */
  async dispatchHeld(job: { cityId: string; vertical: Vertical; zoneId: string }): Promise<boolean> {
    const live = await this.liveSwitches(job.cityId);
    return live.some(
      (s) => s.holdDispatch && ((s.scope === 'vertical' && s.key === job.vertical) || (s.scope === 'zone' && s.key === job.zoneId && (s.vertical === null || s.vertical === job.vertical))),
    );
  }

  // ───────────────────────── console: switches & throttle ─────────────────────────

  private async targets(cityId: string): Promise<{ zones: Map<string, string>; restaurants: Map<string, string> }> {
    const zones = new Map((this.config.city(cityId)?.zones ?? []).map((z) => [z.id, z.name_ar]));
    const restaurants = new Map((await this.orgs.merchants(cityId)).map((m) => [m.id, m.name]));
    return { zones, restaurants };
  }

  private labelOf(s: { scope: KillSwitchRecord['scope']; key: string; vertical: Vertical | null }, t: { zones: Map<string, string>; restaurants: Map<string, string> }): string {
    const base =
      s.scope === 'vertical'
        ? VERTICAL_AR[s.key as Vertical] ?? s.key
        : s.scope === 'zone'
          ? t.zones.get(s.key) ?? s.key
          : s.scope === 'restaurant'
            ? t.restaurants.get(s.key) ?? s.key
            : this.corridors.find((c) => c.id === s.key)?.name_ar ?? s.key;
    return s.scope === 'zone' && s.vertical ? `${base} · ${VERTICAL_AR[s.vertical]}` : base;
  }

  private switchView(s: KillSwitchRecord, label: string, names: Record<string, string | null>, now: Date): KillSwitchView {
    const expired = s.expiresAt !== null && s.expiresAt.getTime() <= now.getTime();
    return {
      id: s.id,
      cityId: s.cityId,
      // view() and setSwitch only pass kill-switch rows; screen rows have their own view.
      scope: s.scope as KillScope,
      key: s.key,
      label_ar: label,
      vertical: s.vertical,
      active: s.active && !expired,
      holdDispatch: s.holdDispatch,
      message_ar: s.messageAr,
      reason: s.reason,
      setBy: s.setById,
      setByName: names[s.setById] ?? null,
      setAt: s.setAt,
      expiresAt: s.expiresAt,
    };
  }

  private capacityView(cityId: string, zoneKey: string, cap: ZoneCapacityRecord | undefined, active: number, killed: boolean): ZoneCapacityView {
    const zone = this.config.city(cityId)?.zones.find((z) => z.id === zoneKey);
    const maxActive = cap?.maxActive ?? null;
    return {
      zoneKey,
      name_ar: zone?.name_ar ?? zoneKey,
      tier: zone?.tier ?? 'edge',
      maxActive,
      mode: cap?.mode ?? 'refuse',
      etaMin: cap?.etaMin ?? DEFAULT_THROTTLE_ETA_MIN,
      active,
      ...loadState(maxActive, active, killed),
      killed,
      setBy: cap?.setById ?? null,
      setAt: cap?.setAt ?? null,
    };
  }

  async view(cityId: string): Promise<ControlsView> {
    const now = this.clock.now();
    const [rows, caps, counts, t] = await Promise.all([this.repo.switches(cityId), this.repo.capacities(cityId), this.activeOrders(cityId), this.targets(cityId)]);
    const names = await this.names.of(rows.map((r) => r.setById));
    const views = rows
      .filter((s) => s.scope !== 'screen' && (s.active || now.getTime() - s.setAt.getTime() < RECENT_MS))
      .map((s) => this.switchView(s, this.labelOf(s, t), names, now))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.setAt.getTime() - a.setAt.getTime());
    const on = views.filter((v) => v.active);
    const killedZones = new Set(on.filter((v) => v.scope === 'zone' && v.vertical === null).map((v) => v.key));
    const zones = [...t.zones.keys()].map((zoneKey) =>
      this.capacityView(
        cityId,
        zoneKey,
        caps.find((c) => c.zoneKey === zoneKey),
        counts.get(zoneKey) ?? 0,
        killedZones.has(zoneKey),
      ),
    );
    let activeOrders = 0;
    for (const n of counts.values()) activeOrders += n;
    const isOn = (scope: KillSwitchView['scope'], key: string) => on.some((v) => v.scope === scope && v.key === key && v.vertical === null);
    return {
      cityId,
      at: now,
      switches: views,
      zones,
      verticals: Vertical.options.map((v) => ({ key: v, label_ar: VERTICAL_AR[v], killed: isOn('vertical', v) })),
      restaurants: [...t.restaurants].map(([key, label]) => ({ key, label_ar: label, killed: isOn('restaurant', key) })).sort((a, b) => a.label_ar.localeCompare(b.label_ar, 'ar')),
      corridors: this.corridors.map((c) => ({ key: c.id, label_ar: c.name_ar, killed: isOn('corridor', c.id) })),
      activeOrders,
    };
  }

  async setSwitch(actor: Actor, input: z.output<typeof SetKillSwitchInput>): Promise<KillSwitchView> {
    const t = await this.targets(input.cityId);
    const valid =
      input.scope === 'vertical'
        ? (Vertical.options as readonly string[]).includes(input.key)
        : input.scope === 'zone'
          ? t.zones.has(input.key)
          : input.scope === 'restaurant'
            ? t.restaurants.has(input.key)
            : this.corridors.some((c) => c.id === input.key);
    const now = this.clock.now();
    if (!valid || (input.expiresAt && input.expiresAt.getTime() <= now.getTime())) throw new DriverError('control_invalid');
    const vertical = input.scope === 'zone' ? (input.vertical ?? null) : null;
    const label = this.labelOf({ scope: input.scope, key: input.key, vertical }, t);
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.upsertSwitch(
        {
          cityId: input.cityId,
          scope: input.scope,
          key: input.key,
          vertical,
          target: targetOf(input.scope, input.key, vertical),
          active: input.active,
          // Only vertical and zone switches can hold dispatch (jobs carry no restaurant or corridor).
          holdDispatch: input.active && input.holdDispatch && (input.scope === 'vertical' || input.scope === 'zone'),
          messageAr: input.message_ar || null,
          reason: input.reason,
          setById: actor.personId,
          setAt: now,
          expiresAt: input.active ? (input.expiresAt ?? null) : null,
        },
        tx,
      );
      await this.events.emit(
        tx,
        {
          actorId: actor.personId,
          type: input.active ? 'ops.kill_switch_on' : 'ops.kill_switch_off',
          occurredAt: now,
          payload: { cityId: input.cityId, scope: input.scope, key: input.key, vertical, holdDispatch: saved.holdDispatch, reason: input.reason, expiresAt: saved.expiresAt?.toISOString() ?? null },
        },
        { name: 'ops_control', id: `${input.cityId}:${saved.target}` },
      );
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: input.active ? 'kill_switch.on' : 'kill_switch.off',
          subjectKind: 'kill_switch',
          subjectId: saved.target,
          summaryAr: input.active ? `وقّف ${label}${saved.holdDispatch ? ' وأوقف الإرسال التلقائي' : ''}: ${input.reason}` : `رجّع ${label}: ${input.reason}`,
          detail: { scope: input.scope, key: input.key, vertical, message_ar: saved.messageAr, expiresAt: saved.expiresAt?.toISOString() ?? null },
        },
        tx,
      );
      return saved;
    });
    this.switchCache.delete(input.cityId);
    return this.switchView(row, label, await this.names.of([row.setById]), now);
  }

  async setCapacity(actor: Actor, input: z.output<typeof SetZoneCapacityInput>): Promise<ZoneCapacityView> {
    const t = await this.targets(input.cityId);
    if (!t.zones.has(input.zoneKey)) throw new DriverError('control_invalid');
    const now = this.clock.now();
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.upsertCapacity({ cityId: input.cityId, zoneKey: input.zoneKey, maxActive: input.maxActive, mode: input.mode, etaMin: input.etaMin, setById: actor.personId, setAt: now }, tx);
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'ops.zone_capacity_set', occurredAt: now, payload: { cityId: input.cityId, zoneKey: input.zoneKey, maxActive: input.maxActive, mode: input.mode, etaMin: input.etaMin } },
        { name: 'ops_control', id: `${input.cityId}:capacity:${input.zoneKey}` },
      );
      const zone = t.zones.get(input.zoneKey) ?? input.zoneKey;
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: 'capacity.set',
          subjectKind: 'capacity',
          subjectId: input.zoneKey,
          summaryAr: input.maxActive === null ? `شال سقف الطلبات عن ${zone}` : `سقف ${zone}: ${input.maxActive} طلب نشط (${input.mode === 'queue' ? 'حجز لوقت لاحق' : 'رفض'}، انتظار ${input.etaMin} دقيقة)`,
          detail: { maxActive: input.maxActive, mode: input.mode, etaMin: input.etaMin },
        },
        tx,
      );
      return saved;
    });
    const live = await this.liveSwitches(input.cityId);
    const killed = live.some((s) => s.scope === 'zone' && s.key === input.zoneKey && s.vertical === null);
    const active = (await this.activeOrders(input.cityId)).get(input.zoneKey) ?? 0;
    return this.capacityView(input.cityId, input.zoneKey, row, active, killed);
  }

  audit(input: z.output<typeof AuditInput>): Promise<AuditEntry[]> {
    return this.audits.list({ cityId: input.cityId, subjectKind: input.subjectKind, limit: input.limit });
  }

  // ───────────────────────── screen switches (W6) ─────────────────────────

  private static audienceOf(rows: KillSwitchRecord[], key: ScreenSwitch): ScreenAudience {
    const on = (who: 'staff' | 'all') => rows.some((r) => r.scope === 'screen' && r.key === screenKey(key, who) && r.active);
    return on('all') ? 'all' : on('staff') ? 'staff' : 'off';
  }

  /** Which redesigned screens this caller sees: on for everyone, or on for staff and the caller is staff. */
  async screens(input: ScreensInput, isStaff: () => Promise<boolean>): Promise<PublicScreens> {
    const live = await this.liveSwitches(input.cityId ?? 'aziziyah');
    const audience = Object.fromEntries(ScreenSwitch.options.map((k) => [k, ControlsService.audienceOf(live, k)])) as Record<ScreenSwitch, ScreenAudience>;
    const staff = Object.values(audience).includes('staff') ? await isStaff() : false;
    const shown = (k: ScreenSwitch) => audience[k] === 'all' || (audience[k] === 'staff' && staff);
    return { basket_v2: shown('basket_v2'), checkout_v2: shown('checkout_v2'), track_v2: shown('track_v2'), orders_v2: shown('orders_v2') };
  }

  async screenSwitches(cityId: string): Promise<ScreenSwitchView[]> {
    const rows = (await this.repo.switches(cityId)).filter((r) => r.scope === 'screen');
    const names = await this.names.of(rows.map((r) => r.setById));
    return ScreenSwitch.options.map((key) => this.screenView(cityId, key, rows, names));
  }

  private screenView(cityId: string, key: ScreenSwitch, rows: KillSwitchRecord[], names: Record<string, string | null>): ScreenSwitchView {
    // Both rows are written together; the newer one carries who changed it last and why.
    const last = rows.filter((r) => r.key === screenKey(key, 'staff') || r.key === screenKey(key, 'all')).sort((a, b) => b.setAt.getTime() - a.setAt.getTime())[0];
    return {
      cityId,
      key,
      audience: ControlsService.audienceOf(rows, key),
      reason: last?.reason ?? null,
      setBy: last?.setById ?? null,
      setByName: last ? (names[last.setById] ?? null) : null,
      setAt: last?.setAt ?? null,
    };
  }

  async setScreen(actor: Actor, input: z.output<typeof SetScreenSwitchInput>): Promise<ScreenSwitchView> {
    const now = this.clock.now();
    const rows = await this.uow.run(async (tx) => {
      const saved: KillSwitchRecord[] = [];
      for (const who of ['staff', 'all'] as const) {
        const key = screenKey(input.key, who);
        saved.push(
          await this.repo.upsertSwitch(
            {
              cityId: input.cityId,
              scope: 'screen',
              key,
              vertical: null,
              target: targetOf('screen', key, null),
              // Everyone includes staff.
              active: who === 'staff' ? input.audience !== 'off' : input.audience === 'all',
              holdDispatch: false,
              messageAr: null,
              reason: input.reason,
              setById: actor.personId,
              setAt: now,
              expiresAt: null,
            },
            tx,
          ),
        );
      }
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'ops.screen_switch_set', occurredAt: now, payload: { cityId: input.cityId, key: input.key, audience: input.audience, reason: input.reason } },
        { name: 'ops_control', id: `${input.cityId}:screen:${input.key}` },
      );
      await this.audits.record(
        {
          cityId: input.cityId,
          actorId: actor.personId,
          action: 'screen.set',
          subjectKind: 'screen',
          subjectId: input.key,
          summaryAr: `الشاشة الجديدة «${SCREEN_AR[input.key]}» صارت ${AUDIENCE_AR[input.audience]}: ${input.reason}`,
          detail: { key: input.key, audience: input.audience },
        },
        tx,
      );
      return saved;
    });
    this.switchCache.delete(input.cityId);
    return this.screenView(input.cityId, input.key, rows, await this.names.of([actor.personId]));
  }

  // ───────────────────────── status banner ─────────────────────────

  private async liveBanners(): Promise<BannerRecord[]> {
    const now = this.clock.now();
    if (this.bannerCache && now.getTime() - this.bannerCache.at < BANNER_CACHE_MS) return this.bannerCache.rows;
    const rows = await this.repo.liveBanners(now);
    this.bannerCache = { at: now.getTime(), rows };
    return rows;
  }

  /** What an open app shows now: the most severe live banner for its audience and city, newest first. */
  async banner(input: BannerInput): Promise<PublicBanner | null> {
    const now = this.clock.now().getTime();
    const pick = (await this.liveBanners())
      .filter((b) => !b.clearedAt && b.startsAt.getTime() <= now && b.expiresAt.getTime() > now && b.audiences.includes(input.app) && (b.cityId === null || !input.cityId || b.cityId === input.cityId))
      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.setAt.getTime() - a.setAt.getTime())[0];
    return pick ? { id: pick.id, severity: pick.severity, message_ar: pick.messageAr, message_en: pick.messageEn, expiresAt: pick.expiresAt } : null;
  }

  private bannerView(b: BannerRecord, names: Record<string, string | null>, now: Date): SystemBannerView {
    return {
      id: b.id,
      cityId: b.cityId,
      severity: b.severity,
      audiences: b.audiences,
      message_ar: b.messageAr,
      message_en: b.messageEn,
      startsAt: b.startsAt,
      expiresAt: b.expiresAt,
      active: !b.clearedAt && b.startsAt.getTime() <= now.getTime() && b.expiresAt.getTime() > now.getTime(),
      setBy: b.setById,
      setByName: names[b.setById] ?? null,
      setAt: b.setAt,
      clearedAt: b.clearedAt,
    };
  }

  async banners(): Promise<SystemBannerView[]> {
    const now = this.clock.now();
    const rows = await this.repo.recentBanners(20);
    const names = await this.names.of(rows.map((r) => r.setById));
    return rows.map((b) => this.bannerView(b, names, now));
  }

  async setBanner(actor: Actor, input: z.output<typeof SetBannerInput>): Promise<SystemBannerView> {
    const now = this.clock.now();
    const startsAt = input.startsAt && input.startsAt.getTime() > now.getTime() ? input.startsAt : now;
    if (input.expiresAt.getTime() <= startsAt.getTime() || input.expiresAt.getTime() - startsAt.getTime() > BANNER_MAX_MS) throw new DriverError('banner_invalid');
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.createBanner(
        {
          cityId: input.cityId ?? null,
          severity: input.severity,
          audiences: [...new Set(input.audiences)],
          messageAr: input.message_ar,
          messageEn: input.message_en || null,
          startsAt,
          expiresAt: input.expiresAt,
          setById: actor.personId,
          setAt: now,
          clearedAt: null,
          clearedById: null,
        },
        tx,
      );
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'system.banner_set', occurredAt: now, payload: { bannerId: saved.id, cityId: saved.cityId, severity: saved.severity, audiences: saved.audiences, startsAt: startsAt.toISOString(), expiresAt: saved.expiresAt.toISOString() } },
        { name: 'system_banner', id: saved.id },
      );
      await this.audits.record(
        { cityId: saved.cityId, actorId: actor.personId, action: 'banner.set', subjectKind: 'banner', subjectId: saved.id, summaryAr: `إعلان ${SEVERITY_AR[saved.severity]}: ${saved.messageAr}`, detail: { audiences: saved.audiences, expiresAt: saved.expiresAt.toISOString() } },
        tx,
      );
      return saved;
    });
    this.bannerCache = null;
    return this.bannerView(row, await this.names.of([row.setById]), now);
  }

  async clearBanner(actor: Actor, input: { bannerId: string }): Promise<SystemBannerView> {
    const now = this.clock.now();
    const existing = await this.repo.banner(input.bannerId);
    if (!existing) throw new DriverError('banner_not_found');
    if (existing.clearedAt) return this.bannerView(existing, await this.names.of([existing.setById]), now);
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.clearBanner(existing.id, actor.personId, now, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'system.banner_cleared', occurredAt: now, payload: { bannerId: saved.id } }, { name: 'system_banner', id: saved.id });
      await this.audits.record({ cityId: saved.cityId, actorId: actor.personId, action: 'banner.clear', subjectKind: 'banner', subjectId: saved.id, summaryAr: `شال الإعلان: ${saved.messageAr}` }, tx);
      return saved;
    });
    this.bannerCache = null;
    return this.bannerView(row, await this.names.of([row.setById]), now);
  }

  // ───────────────────────── quiet days and the season ─────────────────────────

  private async liveQuiet(): Promise<QuietRecord[]> {
    const now = this.clock.now();
    if (this.quietCache && now.getTime() - this.quietCache.at < QUIET_CACHE_MS) return this.quietCache.rows;
    const rows = await this.repo.liveQuiet(localDateKey(now));
    this.quietCache = { at: now.getTime(), rows };
    return rows;
  }

  /**
   * What an open app may do today (on a quiet day no celebrations, no moment sounds and no offers),
   * the kind of day, Ramadan's times on both timetables and the home card (J6, `season.ts`).
   */
  async season(input: SeasonInput): Promise<PublicSeason> {
    return composeSeason({ rows: await this.liveQuiet(), now: this.clock.now(), cityId: input.cityId, timetable: input.timetable });
  }

  /** The notify engine's gate for offers: suppressed on quiet days and seasons with offers off, held around iftar (J6). */
  async promoHold(at: Date, cityId?: string): Promise<PromoHold | null> {
    return promoHold({ rows: await this.liveQuiet(), at, cityId });
  }

  /** A mourning day (kind `quiet`) covers `at`'s Baghdad date here. Ramadan and Eid are not quiet. */
  async isQuietDay(at: Date, cityId?: string): Promise<boolean> {
    return composeSeason({ rows: await this.liveQuiet(), now: at, cityId }).quiet;
  }

  private quietView(q: QuietRecord, names: Record<string, string | null>, now: Date): QuietDaysView {
    const day = localDateKey(now);
    return {
      id: q.id,
      cityId: q.cityId,
      startsOn: q.startsOn,
      endsOn: q.endsOn,
      label_ar: q.labelAr,
      active: !q.clearedAt && q.startsOn <= day && day <= q.endsOn,
      setBy: q.setById,
      setByName: names[q.setById] ?? null,
      setAt: q.setAt,
      clearedAt: q.clearedAt,
    };
  }

  async quietDays(): Promise<QuietDaysView[]> {
    const now = this.clock.now();
    const rows = (await this.repo.recentQuiet(30)).filter((r) => r.kind === 'quiet');
    const names = await this.names.of(rows.map((r) => r.setById));
    return rows.map((q) => this.quietView(q, names, now));
  }

  async setQuietDays(actor: Actor, input: z.output<typeof SetQuietDaysInput>): Promise<QuietDaysView> {
    const now = this.clock.now();
    const today = localDateKey(now);
    if (input.startsOn < today || input.endsOn < input.startsOn || daysBetween(input.startsOn, input.endsOn) + 1 > QUIET_MAX_DAYS) throw new DriverError('quiet_invalid');
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.createQuiet(
        { cityId: input.cityId ?? null, startsOn: input.startsOn, endsOn: input.endsOn, labelAr: input.label_ar, setById: actor.personId, setAt: now, clearedAt: null, clearedById: null, ...QUIET_DEFAULTS, iftarOverrides: {} },
        tx,
      );
      await this.audits.record(
        { cityId: saved.cityId, actorId: actor.personId, action: 'quiet.set', subjectKind: 'quiet', subjectId: saved.id, summaryAr: `أيام هدوء: ${saved.labelAr} (${saved.startsOn} – ${saved.endsOn})`, detail: { startsOn: saved.startsOn, endsOn: saved.endsOn } },
        tx,
      );
      return saved;
    });
    this.quietCache = null;
    return this.quietView(row, await this.names.of([row.setById]), now);
  }

  async clearQuietDays(actor: Actor, input: { quietId: string }): Promise<QuietDaysView> {
    const now = this.clock.now();
    const row = await this.clearPeriod(actor, input.quietId);
    return this.quietView(row, await this.names.of([row.setById]), now);
  }

  // ───────────────────────── seasons (J6) ─────────────────────────

  private seasonView(q: QuietRecord, names: Record<string, string | null>, now: Date): SeasonView {
    return {
      ...this.quietView(q, names, now),
      kind: q.kind,
      celebrations: q.celebrations,
      sounds: q.sounds,
      promos: q.promos,
      accent: q.accent,
      homeCard: q.homeCard,
      homeCardAr: q.homeCardAr,
      shiaOffsetMin: q.shiaOffsetMin,
      days: seasonDays(q),
    };
  }

  /** Every recent season period (any kind), newest first; Ramadan rows carry their day times. */
  async seasons(): Promise<SeasonView[]> {
    const now = this.clock.now();
    const rows = await this.repo.recentQuiet(60);
    const names = await this.names.of(rows.map((r) => r.setById));
    return rows.map((q) => this.seasonView(q, names, now));
  }

  async setSeason(actor: Actor, input: z.output<typeof SetSeasonInput>): Promise<SeasonView> {
    const now = this.clock.now();
    const today = localDateKey(now);
    const problem = checkNewSeason(input, today, await this.repo.liveQuiet(today));
    if (problem) throw new DriverError(problem);
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.createQuiet(
        { cityId: input.cityId ?? null, startsOn: input.startsOn, endsOn: input.endsOn, labelAr: input.label_ar, setById: actor.personId, setAt: now, clearedAt: null, clearedById: null, ...normalizeSeason(input), iftarOverrides: {} },
        tx,
      );
      await this.audits.record(
        {
          cityId: saved.cityId,
          actorId: actor.personId,
          action: saved.kind === 'quiet' ? 'quiet.set' : 'season.set',
          subjectKind: saved.kind === 'quiet' ? 'quiet' : 'season',
          subjectId: saved.id,
          summaryAr: `${SEASON_KIND_AR[saved.kind]}: ${saved.labelAr} (${saved.startsOn} – ${saved.endsOn})`,
          detail: { kind: saved.kind, startsOn: saved.startsOn, endsOn: saved.endsOn, celebrations: saved.celebrations, sounds: saved.sounds, promos: saved.promos, accent: saved.accent, shiaOffsetMin: saved.shiaOffsetMin },
        },
        tx,
      );
      return saved;
    });
    this.quietCache = null;
    return this.seasonView(row, await this.names.of([row.setById]), now);
  }

  async clearSeason(actor: Actor, input: { seasonId: string }): Promise<SeasonView> {
    const now = this.clock.now();
    const row = await this.clearPeriod(actor, input.seasonId);
    return this.seasonView(row, await this.names.of([row.setById]), now);
  }

  /** Ops set one day's iftar on one timetable to the local mosque's time (null = back to the sun). */
  async setIftarTime(actor: Actor, input: SetIftarTimeInput): Promise<SeasonView> {
    const now = this.clock.now();
    const existing = await this.repo.quiet(input.seasonId);
    if (!existing) throw new DriverError('quiet_not_found');
    if (existing.kind !== 'ramadan' || existing.clearedAt || input.day < existing.startsOn || input.day > existing.endsOn) throw new DriverError('season_invalid');
    const overrides = withIftarOverride(existing.iftarOverrides, input.day, input.timetable, input.time);
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.setIftarOverrides(existing.id, overrides, tx);
      await this.audits.record(
        {
          cityId: saved.cityId,
          actorId: actor.personId,
          action: 'season.iftar',
          subjectKind: 'season',
          subjectId: saved.id,
          summaryAr: `فطور ${input.day} (${TIMETABLE_AR[input.timetable]}): ${input.time ?? 'حسب الشمس'}`,
          detail: { day: input.day, timetable: input.timetable, time: input.time },
        },
        tx,
      );
      return saved;
    });
    this.quietCache = null;
    return this.seasonView(row, await this.names.of([row.setById]), now);
  }

  /** Clears any season period (idempotent), audited as a quiet day or a season by its kind. */
  private async clearPeriod(actor: Actor, id: string): Promise<QuietRecord> {
    const now = this.clock.now();
    const existing = await this.repo.quiet(id);
    if (!existing) throw new DriverError('quiet_not_found');
    if (existing.clearedAt) return existing;
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.clearQuiet(existing.id, actor.personId, now, tx);
      const quiet = saved.kind === 'quiet';
      await this.audits.record(
        {
          cityId: saved.cityId,
          actorId: actor.personId,
          action: quiet ? 'quiet.clear' : 'season.clear',
          subjectKind: quiet ? 'quiet' : 'season',
          subjectId: saved.id,
          summaryAr: quiet ? `شال أيام الهدوء: ${saved.labelAr}` : `شال ${SEASON_KIND_AR[saved.kind]}: ${saved.labelAr}`,
        },
        tx,
      );
      return saved;
    });
    this.quietCache = null;
    return row;
  }
}

