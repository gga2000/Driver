import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import {
  AZIZIYAH_ZONES,
  DriverError,
  openRing,
  ringAreaM2,
  westernDigits,
  zoneProblemText,
  zoneServiceBounds,
  zoneShapeProblem,
  type Actor,
  type AziziyahZoneSeed,
  type PlaceZoneInput,
  type ZonePlacementView,
  type ZonesPort,
} from '@driver/contracts';
import { CLOCK, type Clock } from '../../shared/clock.js';
import { UnitOfWork } from '../../shared/db/unit-of-work.js';
import { AuditLogService, StaffNames } from '../controls/index.js';
import { EventsService } from '../events/index.js';
import { ZONES_REPOSITORY, type ZoneRecord, type ZonesRepository } from './zones.repository.js';

const SEEDS = new Map<string, readonly AziziyahZoneSeed[]>([['aziziyah', AZIZIYAH_ZONES]]);

function view(seed: AziziyahZoneSeed, row: ZoneRecord, names: Record<string, string | null>): ZonePlacementView {
  return {
    key: seed.id,
    name_ar: westernDigits(seed.name_ar),
    name_en: seed.name_en,
    tier: seed.tier,
    group: seed.group,
    placement: row.placement,
    ring: row.ring,
    centre: row.centre ?? { lat: seed.lat, lng: seed.lng },
    areaM2: Math.round(ringAreaM2(row.ring)),
    placedBy: row.placedById ? (names[row.placedById] ?? null) : null,
    placedAt: row.placedAt,
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
  ) {}

  async list(cityId: string): Promise<ZonePlacementView[]> {
    const rows = new Map((await this.repo.list(cityId)).map((r) => [r.key, r]));
    const names = await this.names.of([...rows.values()].flatMap((r) => (r.placedById ? [r.placedById] : [])));
    return (SEEDS.get(cityId) ?? []).flatMap((seed) => {
      const row = rows.get(seed.id);
      return row ? [view(seed, row, names)] : [];
    });
  }

  async place(actor: Actor, input: z.output<typeof PlaceZoneInput>): Promise<ZonePlacementView> {
    const seeds = SEEDS.get(input.cityId) ?? [];
    const seed = seeds.find((s) => s.id === input.key);
    const bounds = zoneServiceBounds(input.cityId);
    if (!seed || !bounds) throw new DriverError('zone_unknown');
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
        { cityId: input.cityId, actorId: actor.personId, action: 'zone.placed', subjectKind: 'zone', subjectId: input.key, summaryAr: `حط حدود ${westernDigits(seed.name_ar)} على الخريطة`, detail: { points: ring.length, areaM2 } },
        tx,
      );
      return saved;
    });
    return view(seed, row, await this.names.of([actor.personId]));
  }
}
