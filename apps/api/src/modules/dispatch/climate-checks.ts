import { Inject, Injectable } from '@nestjs/common';
import { climateShiftAt, DriverError, shiftIdAt, type ClimateFeature, type PartnerClimateCheck, type VehicleFeature } from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import type { PrismaService } from '../../shared/db/prisma.service.js';

/**
 * «المكيّفة شغالة اليوم؟» (ride idea x1): a ride driver's answer for one shift about his car's AC (hot
 * days) or heating (cold days), `driver_shift_checks`. Dispatch owns it because what it changes is who
 * counts as an AC car: a «لا» takes the ops-confirmed tag off until the shift ends, for the waves (n6,
 * x1) and for everything riders are shown (the offered drivers, the profile, the courier card).
 */
export interface ShiftCheckRecord {
  driverId: string;
  /** `2026-07-14:day` (`shiftIdAt`). */
  shiftId: string;
  feature: ClimateFeature;
  working: boolean;
  answeredAt: Date;
}

export interface ShiftCheckStore {
  get(driverId: string, shiftId: string, feature: ClimateFeature): Promise<ShiftCheckRecord | null>;
  /** His latest answer for the shift wins (it broke at noon, it was fixed by four). */
  put(rec: ShiftCheckRecord): Promise<ShiftCheckRecord>;
  /** What these drivers said is not working in this shift; drivers with nothing off are left out. */
  offIn(shiftId: string, driverIds: readonly string[]): Promise<Map<string, ClimateFeature[]>>;
}

export const SHIFT_CHECK_STORE = Symbol('SHIFT_CHECK_STORE');

/** In-process twin (tests, the simulator, the database-less demo API). */
export class InMemoryShiftCheckStore implements ShiftCheckStore {
  private readonly rows = new Map<string, ShiftCheckRecord>();

  private key(driverId: string, shiftId: string, feature: ClimateFeature): string {
    return `${driverId}|${shiftId}|${feature}`;
  }

  async get(driverId: string, shiftId: string, feature: ClimateFeature): Promise<ShiftCheckRecord | null> {
    const r = this.rows.get(this.key(driverId, shiftId, feature));
    return r ? { ...r } : null;
  }

  async put(rec: ShiftCheckRecord): Promise<ShiftCheckRecord> {
    this.rows.set(this.key(rec.driverId, rec.shiftId, rec.feature), { ...rec });
    return { ...rec };
  }

  async offIn(shiftId: string, driverIds: readonly string[]): Promise<Map<string, ClimateFeature[]>> {
    const ids = new Set(driverIds);
    const out = new Map<string, ClimateFeature[]>();
    for (const r of this.rows.values()) {
      if (r.shiftId !== shiftId || r.working || !ids.has(r.driverId)) continue;
      out.set(r.driverId, [...(out.get(r.driverId) ?? []), r.feature]);
    }
    return out;
  }
}

/** Bound when DATABASE_URL is set. */
export class PrismaShiftCheckStore implements ShiftCheckStore {
  constructor(private readonly prisma: PrismaService) {}

  private static view(r: { driverId: string; shiftId: string; feature: string; working: boolean; answeredAt: Date }): ShiftCheckRecord {
    return { driverId: r.driverId, shiftId: r.shiftId, feature: r.feature as ClimateFeature, working: r.working, answeredAt: r.answeredAt };
  }

  async get(driverId: string, shiftId: string, feature: ClimateFeature): Promise<ShiftCheckRecord | null> {
    const r = await this.prisma.prisma.driverShiftCheck.findUnique({ where: { driverId_shiftId_feature: { driverId, shiftId, feature } } });
    return r ? PrismaShiftCheckStore.view(r) : null;
  }

  async put(rec: ShiftCheckRecord): Promise<ShiftCheckRecord> {
    const r = await this.prisma.prisma.driverShiftCheck.upsert({
      where: { driverId_shiftId_feature: { driverId: rec.driverId, shiftId: rec.shiftId, feature: rec.feature } },
      create: { driverId: rec.driverId, shiftId: rec.shiftId, feature: rec.feature, working: rec.working, answeredAt: rec.answeredAt },
      update: { working: rec.working, answeredAt: rec.answeredAt },
    });
    return PrismaShiftCheckStore.view(r);
  }

  async offIn(shiftId: string, driverIds: readonly string[]): Promise<Map<string, ClimateFeature[]>> {
    const ids = [...new Set(driverIds)];
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.prisma.driverShiftCheck.findMany({ where: { shiftId, working: false, driverId: { in: ids } }, select: { driverId: true, feature: true } });
    const out = new Map<string, ClimateFeature[]>();
    for (const r of rows) out.set(r.driverId, [...(out.get(r.driverId) ?? []), r.feature as ClimateFeature]);
    return out;
  }
}

/** What the confirmed features read like while some are off this shift (display order kept). */
export function withoutOff<T extends VehicleFeature>(features: readonly T[], off: readonly VehicleFeature[] | undefined): T[] {
  return off && off.length > 0 ? features.filter((f) => !off.includes(f)) : [...features];
}

/** Reads the features each driver said are not working right now (`ClimateChecks.offNow`). */
export type OffNow = (driverIds: readonly string[]) => Promise<Map<string, readonly VehicleFeature[]>>;

/**
 * The shift question and its answers. `confirmed` is always the car check's word (the fleet registry's
 * `features_confirmed`), passed in by the caller that read the car; this service never reads vehicles.
 */
@Injectable()
export class ClimateChecks {
  constructor(
    @Inject(SHIFT_CHECK_STORE) private readonly store: ShiftCheckStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Features off right now: a «لا» in the shift we are in. Between shifts (02:00–06:00) nothing is. */
  async offNow(driverIds: readonly string[]): Promise<Map<string, ClimateFeature[]>> {
    const shiftId = shiftIdAt(this.clock.now());
    if (!shiftId || driverIds.length === 0) return new Map();
    return this.store.offIn(shiftId, driverIds);
  }

  /**
   * This shift's question for a driver whose car has these confirmed features: on a hot (cold) shift
   * with AC (heating) confirmed, with his answer so far; null when nothing is asked.
   */
  async checkFor(driverId: string, confirmed: readonly VehicleFeature[]): Promise<PartnerClimateCheck | null> {
    const shift = climateShiftAt(this.clock.now());
    if (!shift || !confirmed.includes(shift.feature)) return null;
    const rec = await this.store.get(driverId, shift.shiftId, shift.feature);
    return { feature: shift.feature, climate: shift.climate, shiftId: shift.shiftId, endsAt: shift.endsAt, working: rec?.working ?? null };
  }

  /** نعم / لا for this shift; `climate_check_none` when nothing is asked of him now. */
  async answer(driverId: string, confirmed: readonly VehicleFeature[], working: boolean): Promise<PartnerClimateCheck> {
    const check = await this.checkFor(driverId, confirmed);
    if (!check) throw new DriverError('climate_check_none');
    await this.store.put({ driverId, shiftId: check.shiftId, feature: check.feature, working, answeredAt: this.clock.now() });
    return { ...check, working };
  }
}
