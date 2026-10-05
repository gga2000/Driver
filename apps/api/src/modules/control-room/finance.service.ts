import { Inject, Injectable } from '@nestjs/common';
import {
  AZIZIYAH_CENTRE,
  AZIZIYAH_ZONES,
  type Actor,
  type CourierCashRow,
  type FinanceDeskView,
  type HandoverRow,
  type MerchantPayableRow,
  type NightlyCheck,
  type RoundCollection,
  type SettlementExport,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { BAGHDAD_OFFSET_MIN, localDateKey, localHour, startOfLocalDay } from '../../shared/local-time.js';
import { ConfigService } from '../config/index.js';
import { ConsoleReadService } from '../console/index.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { DispatchService } from '../dispatch/index.js';
import { EventsService } from '../events/index.js';
import { CapsService, LedgerService } from '../ledger/index.js';
import { OrgsService } from '../orgs/index.js';

/** The week-one cash collection round (launch playbook §4): 23:00 local. */
export const ROUND_HOUR_LOCAL = 23;
/** Receipts from 18:00 Baghdad count towards tonight's round ("جمعنا … من …", S-K5)… */
export const ROUND_WINDOW_FROM_HOUR = 18;
/** …and the night runs until 06:00, so a round that goes past midnight stays one round. */
export const ROUND_WINDOW_UNTIL_HOUR = 6;
const UNKNOWN_ZONE = 'unknown';
const HOUR_MS = 3_600_000;

/** Tonight's round window start: 18:00 today, or 18:00 yesterday while it is still before 06:00. */
export function roundWindowStart(now: Date): Date {
  const today = startOfLocalDay(now);
  const day = localHour(now) < ROUND_WINDOW_UNTIL_HOUR ? new Date(today.getTime() - 24 * HOUR_MS) : today;
  return new Date(day.getTime() + ROUND_WINDOW_FROM_HOUR * HOUR_MS);
}

/** One courier's ops-round receipts in the window, summed, with the latest time and reference. */
export function roundCollections(lines: ReadonlyArray<{ type: string; toAccount: string; amount: number; memo?: string | null | undefined; occurredAt: Date }>): Map<string, RoundCollection> {
  const out = new Map<string, RoundCollection>();
  for (const e of lines) {
    if (e.type !== 'driver_settlement' || !e.memo?.startsWith('ops_round') || !e.toAccount.startsWith('cash:')) continue;
    const courierId = e.toAccount.slice('cash:'.length);
    const prev = out.get(courierId);
    const reference = e.memo.includes(':') ? e.memo.slice(e.memo.indexOf(':') + 1) : null;
    out.set(courierId, {
      amountIqd: (prev?.amountIqd ?? 0) + e.amount,
      at: prev && prev.at > e.occurredAt ? prev.at : e.occurredAt,
      reference: prev && prev.at > e.occurredAt ? prev.reference : reference,
    });
  }
  return out;
}

/** Great-circle-free distance for ordering stops inside a ~10 km town (equirectangular, km). */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180)) * 111.32;
  const y = (b.lat - a.lat) * 110.57;
  return Math.hypot(x, y);
}

/**
 * Orders zones as a collection route: nearest neighbour from the town centre (the ops base), over the
 * zone centroids; zones without a known centroid and offline couriers come last.
 */
export function roundOrder(zoneKeys: readonly string[], centroids: ReadonlyMap<string, { lat: number; lng: number }>, start: { lat: number; lng: number } = AZIZIYAH_CENTRE): string[] {
  const left = new Set(zoneKeys.filter((z) => centroids.has(z)));
  const out: string[] = [];
  let at = start;
  while (left.size > 0) {
    let best: string | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const z of left) {
      const d = km(at, centroids.get(z)!);
      if (d < bestD || (d === bestD && best !== null && z < best)) {
        best = z;
        bestD = d;
      }
    }
    out.push(best!);
    left.delete(best!);
    at = centroids.get(best!)!;
  }
  return [...out, ...zoneKeys.filter((z) => !centroids.has(z)).sort()];
}

/** One CSV field: quoted when it holds a comma, quote or newline (RFC 4180). */
export function csvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  // UTF-8 BOM so Excel opens the Arabic names right.
  return `\uFEFF${[header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;
}

/**
 * The nightly cash desk (money & ops §4, decisions §3, launch playbook §4): cash every courier holds
 * against his cap, what each merchant is owed, today's hand-overs (courier → ops round, courier →
 * merchant), the 23:00 collection round ordered as a route through the zones, the live ledger balance
 * check next to the last 02:00 close, and settlement exports as CSV (audited).
 */
@Injectable()
export class FinanceDeskService {
  constructor(
    private readonly ledger: LedgerService,
    private readonly caps: CapsService,
    private readonly dispatch: DispatchService,
    private readonly consoleReads: ConsoleReadService,
    private readonly orgs: OrgsService,
    private readonly events: EventsService,
    private readonly config: ConfigService,
    private readonly names: StaffNames,
    private readonly audits: AuditLogService,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private zoneName(cityId: string, zoneKey: string | null): string | null {
    if (!zoneKey) return null;
    return this.config.city(cityId)?.zones.find((z) => z.id === zoneKey)?.name_ar ?? zoneKey;
  }

  private async couriers(actor: Actor, cityId: string): Promise<CourierCashRow[]> {
    const now = this.clock.now();
    const holders = (await this.ledger.cashInField()).holders;
    const live = new Map((await this.dispatch.liveDrivers(cityId, now)).map((d) => [d.presence.driverId, d]));
    const names = await this.names.of(
      holders.map((h) => h.driverId),
      actor.personId,
      'finance_cash_desk',
    );
    const rows: CourierCashRow[] = [];
    for (const h of holders) {
      const s = await this.caps.status(h.driverId);
      const p = live.get(h.driverId)?.presence;
      rows.push({
        driverId: h.driverId,
        name: names[h.driverId] ?? null,
        zoneKey: p?.zoneId ?? null,
        zone_ar: this.zoneName(cityId, p?.zoneId ?? null),
        online: Boolean(p),
        heldIqd: h.amountIqd,
        owedIqd: s.owedIqd,
        capIqd: s.capIqd,
        fill: s.capIqd > 0 ? s.owedIqd / s.capIqd : 0,
        overCap: s.overCap,
        tier: s.tier,
      });
    }
    return rows.sort((a, b) => Number(b.overCap) - Number(a.overCap) || b.fill - a.fill || b.heldIqd - a.heldIqd);
  }

  private async merchants(cityId: string): Promise<MerchantPayableRow[]> {
    return (await this.consoleReads.merchants(cityId))
      .map((m) => ({ merchantId: m.merchantId, name: m.name, payableIqd: m.balanceIqd, mode: m.mode, exposureCapIqd: m.exposureCapIqd, overExposure: m.overExposure }))
      .sort((a, b) => Number(b.overExposure) - Number(a.overExposure) || b.payableIqd - a.payableIqd);
  }

  private async handovers(actor: Actor, from: Date, to: Date): Promise<HandoverRow[]> {
    const lines = await this.ledger.eventsOfTypes(['driver_settlement', 'merchant_paid_by_courier'], from, to);
    // Both lines land on the courier's `cash:` account (his cash goes down by the hand-over).
    const courierOf = (e: (typeof lines)[number]) => e.toAccount.slice('cash:'.length);
    const names = await this.names.of(lines.map(courierOf), actor.personId, 'finance_cash_desk');
    const merchantNames = new Map<string, string>();
    const rows: HandoverRow[] = [];
    for (const e of lines) {
      const courierId = courierOf(e);
      let counterpart: string | null = null;
      if (e.type === 'merchant_paid_by_courier') {
        const merchantId = e.fromAccount.slice('merchant_cash:'.length);
        if (!merchantNames.has(merchantId)) merchantNames.set(merchantId, await this.orgs.get(merchantId).then((o) => o.name).catch(() => merchantId));
        counterpart = merchantNames.get(merchantId) ?? null;
      } else counterpart = e.memo?.startsWith('ops_round') ? 'جولة العمليات' : e.memo?.startsWith('zaincash') ? 'زين كاش' : e.memo?.startsWith('agent') ? 'وكيل' : 'الشركة';
      rows.push({
        at: e.occurredAt,
        kind: e.type === 'driver_settlement' ? 'courier_to_ops' : 'courier_to_merchant',
        courierId,
        courierName: names[courierId] ?? null,
        counterpart,
        amountIqd: e.amount,
        reference: e.memo ?? null,
      });
    }
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  /**
   * The round as a route through the zones. Couriers ticked off tonight stay on their stop with what
   * was taken ("استلمت"), even when they now hold nothing, so the round reads as progress.
   */
  private round(
    couriers: CourierCashRow[],
    cityId: string,
    at: Date,
    tonight: { from: Date; collected: ReadonlyMap<string, RoundCollection>; collectedOnly: ReadonlyArray<{ driverId: string; name: string | null; zoneKey: string | null }> } = { from: at, collected: new Map(), collectedOnly: [] },
  ): FinanceDeskView['round'] {
    const byZone = new Map<string, Array<Pick<CourierCashRow, 'driverId' | 'name' | 'heldIqd' | 'overCap'>>>();
    for (const c of couriers) {
      const z = c.zoneKey ?? UNKNOWN_ZONE;
      byZone.set(z, [...(byZone.get(z) ?? []), c]);
    }
    for (const c of tonight.collectedOnly) {
      const z = c.zoneKey ?? UNKNOWN_ZONE;
      byZone.set(z, [...(byZone.get(z) ?? []), { driverId: c.driverId, name: c.name, heldIqd: 0, overCap: false }]);
    }
    const centroids = new Map(cityId === 'aziziyah' ? AZIZIYAH_ZONES.map((z) => [z.id, { lat: z.lat, lng: z.lng }] as const) : []);
    const stops = roundOrder([...byZone.keys()], centroids).map((zoneKey, i) => {
      const list = (byZone.get(zoneKey) ?? []).sort((a, b) => Number(b.overCap) - Number(a.overCap) || b.heldIqd - a.heldIqd);
      const collected = list.map((c) => tonight.collected.get(c.driverId) ?? null);
      return {
        seq: i + 1,
        zoneKey,
        zone_ar: zoneKey === UNKNOWN_ZONE ? 'غير متصلين (اتصل بيهم)' : (this.zoneName(cityId, zoneKey) ?? zoneKey),
        couriers: list.map((c, j) => ({ driverId: c.driverId, name: c.name, heldIqd: c.heldIqd, overCap: c.overCap, collected: collected[j] ?? null })),
        totalIqd: list.reduce((a, c) => a + c.heldIqd, 0),
        collectedIqd: collected.reduce((a, c) => a + (c?.amountIqd ?? 0), 0),
      };
    });
    const totalIqd = stops.reduce((a, s) => a + s.totalIqd, 0);
    const collectedIqd = stops.reduce((a, s) => a + (s.collectedIqd ?? 0), 0);
    return { at, stops, totalIqd, collectedIqd, targetIqd: totalIqd + collectedIqd, from: tonight.from };
  }

  /** Tonight's ops-round receipts, and the couriers who were emptied by them (no longer cash holders). */
  private async tonight(actor: Actor, cityId: string, now: Date, couriers: CourierCashRow[]) {
    const from = roundWindowStart(now);
    const collected = roundCollections(await this.ledger.eventsOfTypes(['driver_settlement'], from, new Date(now.getTime() + 1)));
    const holders = new Set(couriers.map((c) => c.driverId));
    const emptied = [...collected.keys()].filter((id) => !holders.has(id));
    const names = emptied.length ? await this.names.of(emptied, actor.personId, 'finance_cash_desk') : {};
    const live = emptied.length ? new Map((await this.dispatch.liveDrivers(cityId, now)).map((d) => [d.presence.driverId, d.presence.zoneId ?? null])) : new Map<string, string | null>();
    return { from, collected, collectedOnly: emptied.map((driverId) => ({ driverId, name: names[driverId] ?? null, zoneKey: live.get(driverId) ?? null })) };
  }

  /** The live invariant ("الدفتر متوازن") and the latest 02:00 close on file. */
  async nightly(): Promise<NightlyCheck> {
    const now = this.clock.now();
    const inv = await this.ledger.checkInvariant();
    let lastClose: NightlyCheck['lastClose'] = null;
    for (const back of [0, 1, 2]) {
      const day = localDateKey(new Date(now.getTime() - back * 86_400_000));
      const e = (await this.events.forAggregate('ledger', day)).filter((x) => x.type === 'ledger.nightly_closed').at(-1);
      if (e) {
        lastClose = { day, ok: e.payload['ok'] === true, runAt: e.occurredAt };
        break;
      }
    }
    return {
      ok: inv.ok,
      message_ar: inv.ok ? 'الدفتر متوازن' : `الدفتر مو متوازن: فرق ${inv.money.net.toLocaleString('en-US')} دينار`,
      moneyNet: inv.money.net,
      pointsNet: inv.points.net,
      kindViolations: inv.kindViolations,
      checkedAt: now,
      lastClose,
    };
  }

  /** 23:00 local today (or tonight's, once it has passed it stays on today's until midnight). */
  private roundAt(now: Date): Date {
    return new Date(startOfLocalDay(now).getTime() + ROUND_HOUR_LOCAL * 3_600_000);
  }

  async desk(actor: Actor, cityId: string): Promise<FinanceDeskView> {
    const now = this.clock.now();
    const [couriers, merchants, handovers, nightly] = await Promise.all([this.couriers(actor, cityId), this.merchants(cityId), this.handovers(actor, startOfLocalDay(now), now), this.nightly()]);
    return {
      cityId,
      at: now,
      localDate: localDateKey(now),
      couriers,
      merchants,
      handovers,
      round: this.round(couriers, cityId, this.roundAt(now), await this.tonight(actor, cityId, now, couriers)),
      nightly,
      totals: {
        cashInFieldIqd: couriers.reduce((a, c) => a + c.heldIqd, 0),
        merchantsPayableIqd: merchants.reduce((a, m) => a + Math.max(0, m.payableIqd), 0),
        collectedTodayIqd: handovers.reduce((a, h) => a + h.amountIqd, 0),
        couriersOverCap: couriers.filter((c) => c.overCap).length,
      },
    };
  }

  async exportCsv(actor: Actor, input: { cityId: string; kind: 'couriers' | 'merchants' | 'handovers' | 'round' }): Promise<SettlementExport> {
    const desk = await this.desk(actor, input.cityId);
    const iso = (d: Date) => new Date(d.getTime() + BAGHDAD_OFFSET_MIN * 60_000).toISOString().replace('T', ' ').slice(0, 16);
    let csv: string;
    let rows: number;
    switch (input.kind) {
      case 'couriers':
        csv = toCsv(
          ['driver_id', 'name', 'zone', 'online', 'held_iqd', 'owed_iqd', 'cap_iqd', 'over_cap', 'tier'],
          desk.couriers.map((c) => [c.driverId, c.name, c.zone_ar, c.online ? 'yes' : 'no', c.heldIqd, c.owedIqd, c.capIqd, c.overCap ? 'yes' : 'no', c.tier]),
        );
        rows = desk.couriers.length;
        break;
      case 'merchants':
        csv = toCsv(
          ['merchant_id', 'name', 'payable_iqd', 'mode', 'exposure_cap_iqd', 'over_exposure'],
          desk.merchants.map((m) => [m.merchantId, m.name, m.payableIqd, m.mode, m.exposureCapIqd, m.overExposure ? 'yes' : 'no']),
        );
        rows = desk.merchants.length;
        break;
      case 'handovers':
        csv = toCsv(
          ['at_local', 'kind', 'courier_id', 'courier', 'counterpart', 'amount_iqd', 'reference'],
          desk.handovers.map((h) => [iso(h.at), h.kind, h.courierId, h.courierName, h.counterpart, h.amountIqd, h.reference]),
        );
        rows = desk.handovers.length;
        break;
      case 'round':
        csv = toCsv(
          ['stop', 'zone', 'driver_id', 'courier', 'held_iqd', 'over_cap', 'collected_iqd', 'collected_ref'],
          desk.round.stops.flatMap((s) => s.couriers.map((c) => [s.seq, s.zone_ar, c.driverId, c.name, c.heldIqd, c.overCap ? 'yes' : 'no', c.collected?.amountIqd ?? 0, c.collected?.reference ?? ''])),
        );
        rows = desk.round.stops.reduce((a, s) => a + s.couriers.length, 0);
        break;
    }
    const filename = `driver-${input.kind}-${desk.localDate}.csv`;
    await this.uow.run((tx) =>
      this.audits.record({ cityId: input.cityId, actorId: actor.personId, action: 'finance.export', subjectKind: 'export', subjectId: filename, summaryAr: `صدّر ${filename} (${rows} سطر)`, detail: { kind: input.kind, rows } }, tx),
    );
    return { filename, csv, rows };
  }
}
