import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  AZIZIYAH_ZONES,
  DriverError,
  CreateZoneInput,
  RenameZoneInput,
  RemoveZoneInput,
  openRing,
  ringAreaM2,
  westernDigits,
  zoneProblemText,
  zoneServiceBounds,
  zoneShapeProblem,
  type Actor,
  type AziziyahZoneSeed,
  type PlaceZoneInput,
  type ZoneCheckTally,
  type ZonePlacementView,
  type ZonesPort,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork, type Tx } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { tallyChecks } from './zone-checks.logic.js';
import { ZONE_CHECKS_REPOSITORY, type ZoneChecksRepository, type ZoneOutline } from './zone-checks.repository.js';
import { ZONES_REPOSITORY, type ZoneRecord, type ZonesRepository } from './zones.repository.js';

/** Who confirms a zone when drivers' answers add up (shows as «النظام» in the audit log). */
export const ZONE_CHECKS_ACTOR = 'system:zone-checks';

const SEEDS = new Map<string, readonly AziziyahZoneSeed[]>([['aziziyah', AZIZIYAH_ZONES]]);

/** The outline drivers are asked about: drawn zones only (a draft has nothing drawn to confirm). */
function outlineOf(row: ZoneRecord): ZoneOutline | null {
  return row.placement !== 'draft' && row.placedAt ? { zoneKey: row.key, outlineAt: row.placedAt } : null;
}

function view(seed: AziziyahZoneSeed | undefined, row: ZoneRecord, names: Record<string, string | null>, checks?: ZoneCheckTally): ZonePlacementView {
  return {
    key: row.key,
    name_ar: westernDigits(row.nameAr ?? seed?.name_ar ?? row.key),
    name_en: row.nameEn ?? seed?.name_en ?? row.key,
    tier: row.tier ?? seed?.tier ?? 'near',
    group: seed?.group ?? row.tier ?? 'near',
    placement: row.placement,
    ring: row.ring,
    centre: row.centre ?? { lat: seed?.lat ?? 32.905, lng: seed?.lng ?? 45.06 },
    areaM2: Math.round(ringAreaM2(row.ring)),
    placedBy: row.placedById ? (names[row.placedById] ?? null) : null,
    placedAt: row.placedAt,
    ...(checks ? { checks } : {}),
  };
}

/**
 * Zone outlines (maps program SP3). Ali and field ops draw them in the Console; each save is
 * validated (shape, service area, overlap with other drawn zones), audited and evented. Pricing and
 * dispatch still use the seed centroids until the switch-over (SP3b), so a save never moves a fee.
 */
@Injectable()
export class ZonesService implements ZonesPort {
  constructor(
    @Inject(ZONES_REPOSITORY) private readonly repo: ZonesRepository,
    private readonly events: EventsService,
    private readonly audits: AuditLogService,
    private readonly names: StaffNames,
    private readonly uow: UnitOfWork,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ZONE_CHECKS_REPOSITORY) private readonly checks: ZoneChecksRepository,
  ) {}

  async list(cityId: string): Promise<ZonePlacementView[]> {
    const rows = new Map((await this.repo.list(cityId)).map((r) => [r.key, r]));
    const names = await this.names.of([...rows.values()].flatMap((r) => (r.placedById ? [r.placedById] : [])));
    const outlines = [...rows.values()].flatMap((r) => outlineOf(r) ?? []);
    const answers = await this.checks.answers(cityId, outlines);
    const tallyOf = (row: ZoneRecord): ZoneCheckTally | undefined => {
      const outline = outlineOf(row);
      return outline ? tallyChecks(answers.filter((a) => a.zoneKey === row.key && a.outlineAt.getTime() === outline.outlineAt.getTime())) : undefined;
    };
    return [...rows.values()].filter((row) => row.active !== false).map((row) => view((SEEDS.get(cityId) ?? []).find((seed) => seed.id === row.key), row, names, tallyOf(row)));
  }

  /** A zone's names for the driver's question (Western digits), or null if the city has no such zone. */
  async namesOf(cityId: string, key: string, tx?: Tx): Promise<{ name_ar: string; name_en: string } | null> {
    const row = (await this.repo.list(cityId, tx)).find((r) => r.key === key);
    if (!row) return null;
    const seed = (SEEDS.get(cityId) ?? []).find((s) => s.id === key);
    return { name_ar: westernDigits(row.nameAr ?? seed?.name_ar ?? key), name_en: row.nameEn ?? seed?.name_en ?? key };
  }

  /**
   * Drivers' answers added up (maps program SP3 §5.3): the outline placed at `outlineAt` becomes
   * `confirmed`, audited and evented as the system. A no-op when the outline was redrawn or confirmed
   * meanwhile. Runs in the caller's transaction (the answer that tipped it).
   */
  async confirmByDrivers(cityId: string, key: string, outlineAt: Date, tally: ZoneCheckTally, tx: Tx): Promise<boolean> {
    const now = this.clock.now();
    const row = await this.repo.confirm(cityId, key, outlineAt, now, tx);
    if (!row) return false;
    const name = westernDigits(row.nameAr ?? (SEEDS.get(cityId) ?? []).find((s) => s.id === key)?.name_ar ?? key);
    await this.events.emit(tx, { actorId: ZONE_CHECKS_ACTOR, type: 'zone.confirmed', occurredAt: now, payload: { cityId, key, yes: tally.yes, drivers: tally.drivers } }, { name: 'zone', id: `${cityId}:${key}` });
    await this.audits.record(
      { cityId, actorId: ZONE_CHECKS_ACTOR, action: 'zone.confirmed', subjectKind: 'zone', subjectId: key, summaryAr: `السواق أكدوا حدود ${name}`, detail: { yes: tally.yes, drivers: tally.drivers } },
      tx,
    );
    return true;
  }

  /**
   * A driver said he is not in this zone: the zone tool shows the flag (from the answers) and the
   * audit log keeps who and when, so the field team can go and look.
   */
  async flagByDriver(driverId: string, cityId: string, key: string, tx: Tx): Promise<void> {
    const now = this.clock.now();
    const name = (await this.namesOf(cityId, key, tx))?.name_ar ?? key;
    await this.events.emit(tx, { actorId: driverId, type: 'zone.flagged', occurredAt: now, payload: { cityId, key } }, { name: 'zone', id: `${cityId}:${key}` });
    await this.audits.record({ cityId, actorId: driverId, action: 'zone.flagged', subjectKind: 'zone', subjectId: key, summaryAr: `سايق جاوب إنه مو بمنطقة ${name}`, detail: {} }, tx);
  }

  async place(actor: Actor, input: z.output<typeof PlaceZoneInput>): Promise<ZonePlacementView> {
    const seeds = SEEDS.get(input.cityId) ?? [];
    const seed = seeds.find((s) => s.id === input.key);
    const bounds = zoneServiceBounds(input.cityId);
    if (!bounds) throw new DriverError('zone_unknown');
    const current = (await this.repo.list(input.cityId)).find((r) => r.key === input.key);
    if (!current) throw new DriverError('zone_unknown');
    const ring = openRing(input.ring);
    const others = (await this.repo.list(input.cityId)).filter((r) => r.key !== input.key && r.placement !== 'draft').map((r) => ({ key: r.key, ring: r.ring }));
    const problem = zoneShapeProblem(ring, input.centre, bounds, others);
    if (problem) {
      const nameOf = (key: string): string => westernDigits(seeds.find((s) => s.id === key)?.name_ar ?? key);
      throw new DriverError(problem.kind === 'overlap' ? 'zone_overlap' : 'zone_shape_invalid', { messageAr: zoneProblemText(problem, nameOf) });
    }
    const now = this.clock.now();
    const areaM2 = Math.round(ringAreaM2(ring));
    const row = await this.uow.run(async (tx) => {
      const saved = await this.repo.savePlacement({ cityId: input.cityId, key: input.key, ring, centre: input.centre, placedById: actor.personId, placedAt: now }, tx);
      if (!saved) throw new DriverError('zone_unknown');
      await this.events.emit(
        tx,
        { actorId: actor.personId, type: 'zone.placed', occurredAt: now, payload: { cityId: input.cityId, key: input.key, points: ring.length, areaM2 } },
        { name: 'zone', id: `${input.cityId}:${input.key}` },
      );
      await this.audits.record(
        { cityId: input.cityId, actorId: actor.personId, action: 'zone.placed', subjectKind: 'zone', subjectId: input.key, summaryAr: `حط حدود ${westernDigits(current.nameAr ?? seed?.name_ar ?? input.key)} على الخريطة`, detail: { points: ring.length, areaM2 } },
        tx,
      );
      return saved;
    });
    return view(seed, row, await this.names.of([actor.personId]));
  }

  async create(actor: Actor, input: z.output<typeof CreateZoneInput>): Promise<ZonePlacementView> {
    const bounds = zoneServiceBounds(input.cityId);
    if (!bounds || input.centre.lat < bounds.minLat || input.centre.lat > bounds.maxLat || input.centre.lng < bounds.minLng || input.centre.lng > bounds.maxLng) throw new DriverError('zone_shape_invalid');
    const radiusM = ({ centre: 350, near: 400, mid: 450, far: 550, edge: 600 } as const)[input.tier];
    const now = this.clock.now();
    const row = await this.uow.run(async (tx) => {
      if ((await this.repo.list(input.cityId, tx)).some((zone) => zone.key === input.key)) throw new DriverError('zone_key_taken');
      const created = await this.repo.create({ cityId: input.cityId, key: input.key, nameAr: input.name_ar, nameEn: input.name_en, tier: input.tier, centre: input.centre, radiusM }, tx);
      await this.events.emit(tx, { actorId: actor.personId, type: 'zone.created', occurredAt: now, payload: { cityId: input.cityId, key: input.key }, }, { name: 'zone', id: `${input.cityId}:${input.key}` });
      await this.audits.record({ cityId: input.cityId, actorId: actor.personId, action: 'zone.created', subjectKind: 'zone', subjectId: input.key, summaryAr: `أضاف منطقة ${westernDigits(input.name_ar)}`, detail: { tier: input.tier } }, tx);
      return created;
    });
    return view(undefined, row, await this.names.of([actor.personId]));
  }

  async rename(actor: Actor, input: z.output<typeof RenameZoneInput>): Promise<ZonePlacementView> {
    const now = this.clock.now();
    const row = await this.uow.run(async (tx) => {
      const renamed = await this.repo.rename(input.cityId, input.key, input.name_ar, input.name_en, tx);
      if (!renamed) throw new DriverError('zone_unknown');
      await this.events.emit(tx, { actorId: actor.personId, type: 'zone.renamed', occurredAt: now, payload: { cityId: input.cityId, key: input.key }, }, { name: 'zone', id: `${input.cityId}:${input.key}` });
      await this.audits.record({ cityId: input.cityId, actorId: actor.personId, action: 'zone.renamed', subjectKind: 'zone', subjectId: input.key, summaryAr: `غيّر اسم المنطقة إلى ${westernDigits(input.name_ar)}`, detail: {} }, tx);
      return renamed;
    });
    return view((SEEDS.get(input.cityId) ?? []).find((seed) => seed.id === input.key), row, await this.names.of([actor.personId]));
  }

  async remove(actor: Actor, input: z.output<typeof RemoveZoneInput>): Promise<void> {
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      if (!await this.repo.remove(input.cityId, input.key, tx)) throw new DriverError('zone_unknown');
      await this.events.emit(tx, { actorId: actor.personId, type: 'zone.removed', occurredAt: now, payload: { cityId: input.cityId, key: input.key }, }, { name: 'zone', id: `${input.cityId}:${input.key}` });
      await this.audits.record({ cityId: input.cityId, actorId: actor.personId, action: 'zone.removed', subjectKind: 'zone', subjectId: input.key, summaryAr: `حذف المنطقة ${input.key}`, detail: {} }, tx);
    });
  }
}
