import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { Prisma } from '@driver/db';
import { AZIZIYAH_ZONES, draftRing, LatLng, openRing, ZonePlacement, type AziziyahZoneSeed } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';

/** One zone's outline as stored. */
export interface ZoneRecord {
  cityId: string;
  key: string;
  /** Open ring. */
  ring: LatLng[];
  /** Centre handle; null for AI drafts (the seed centre stands in). */
  centre: LatLng | null;
  placement: ZonePlacement;
  placedAt: Date | null;
  placedById: string | null;
}

export interface SavePlacement {
  cityId: string;
  key: string;
  ring: LatLng[];
  centre: LatLng;
  placedById: string;
  placedAt: Date;
}

export interface ZonesRepository {
  list(cityId: string, tx?: Tx): Promise<ZoneRecord[]>;
  /** Null when the city has no such zone. */
  savePlacement(input: SavePlacement, tx?: Tx): Promise<ZoneRecord | null>;
}

export const ZONES_REPOSITORY = Symbol('ZONES_REPOSITORY');

const DRAFT_SEEDS = new Map<string, readonly AziziyahZoneSeed[]>([['aziziyah', AZIZIYAH_ZONES]]);
const rowKey = (cityId: string, key: string): string => `${cityId}|${key}`;
const copy = (r: ZoneRecord): ZoneRecord => ({ ...r, ring: r.ring.map((p) => ({ ...p })), centre: r.centre ? { ...r.centre } : null });

/** Tests and the plain in-memory API: seed drafts, placements forgotten on restart. */
export class InMemoryZonesRepository implements ZonesRepository {
  protected readonly rows = new Map<string, ZoneRecord>();
  private readonly seeded = new Set<string>();

  private ensure(cityId: string): void {
    if (this.seeded.has(cityId)) return;
    this.seeded.add(cityId);
    for (const z of DRAFT_SEEDS.get(cityId) ?? []) {
      const k = rowKey(cityId, z.id);
      if (!this.rows.has(k)) this.rows.set(k, { cityId, key: z.id, ring: draftRing(z), centre: null, placement: 'draft', placedAt: null, placedById: null });
    }
  }

  async list(cityId: string): Promise<ZoneRecord[]> {
    this.ensure(cityId);
    return [...this.rows.values()].filter((r) => r.cityId === cityId).map(copy);
  }

  async savePlacement(input: SavePlacement): Promise<ZoneRecord | null> {
    this.ensure(input.cityId);
    const k = rowKey(input.cityId, input.key);
    if (!this.rows.has(k)) return null;
    const row: ZoneRecord = { cityId: input.cityId, key: input.key, ring: input.ring.map((p) => ({ ...p })), centre: { ...input.centre }, placement: 'placed', placedAt: input.placedAt, placedById: input.placedById };
    this.rows.set(k, row);
    this.afterWrite();
    return copy(row);
  }

  /** Hook for the file-backed store. */
  protected afterWrite(): void {}
}

const ZoneSnapshot = z.object({
  version: z.literal(1),
  zones: z.array(
    z.object({
      cityId: z.string(),
      key: z.string(),
      ring: z.array(LatLng),
      centre: LatLng.nullable(),
      placement: ZonePlacement,
      placedAt: z.coerce.date().nullable(),
      placedById: z.string().nullable(),
    }),
  ),
});

/**
 * Studio / demo API (`ZONES_STORE_FILE`): the in-memory store, written to a JSON file after every save
 * so outlines drawn in the demo Console survive restarts. Only placed zones are written.
 */
export class FileZonesRepository extends InMemoryZonesRepository {
  constructor(private readonly file: string) {
    super();
    if (!existsSync(file)) return;
    let snapshot: z.infer<typeof ZoneSnapshot>;
    try {
      snapshot = ZoneSnapshot.parse(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      throw new Error(`ZONES_STORE_FILE ${file} is not a zone snapshot: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const r of snapshot.zones) this.rows.set(rowKey(r.cityId, r.key), r);
  }

  protected override afterWrite(): void {
    const zones = [...this.rows.values()].filter((r) => r.placement !== 'draft');
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ version: 1, zones }, null, 2)}\n`);
    renameSync(tmp, this.file);
  }
}

interface ZoneRow {
  key: string;
  polygon: string;
  lat: number | null;
  lng: number | null;
  placement: string;
  placed_at: Date | null;
  placed_by_id: string | null;
}

const COLUMNS = Prisma.sql`"key", ST_AsGeoJSON("polygon"::geometry) AS polygon, ST_Y("centre"::geometry) AS lat, ST_X("centre"::geometry) AS lng, "placement", "placed_at", "placed_by_id"`;
const GeoJsonPolygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1) });

function fromRow(cityId: string, r: ZoneRow): ZoneRecord {
  const outer = GeoJsonPolygon.parse(JSON.parse(r.polygon)).coordinates[0]!;
  return {
    cityId,
    key: r.key,
    ring: openRing(outer.map(([lng, lat]) => ({ lat, lng }))),
    centre: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
    placement: ZonePlacement.parse(r.placement),
    placedAt: r.placed_at,
    placedById: r.placed_by_id,
  };
}

function ringWkt(ring: readonly LatLng[]): string {
  const r = openRing(ring);
  return `POLYGON((${[...r, r[0]!].map((p) => `${p.lng} ${p.lat}`).join(', ')}))`;
}

/** Postgres: `zones.polygon` / `centre` are PostGIS geography, written and read with raw SQL. */
export class PrismaZonesRepository implements ZonesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private db(tx?: Tx): Tx {
    return tx ?? (this.prisma.prisma as unknown as Tx);
  }

  async list(cityId: string, tx?: Tx): Promise<ZoneRecord[]> {
    const rows = await this.db(tx).$queryRaw<ZoneRow[]>`SELECT ${COLUMNS} FROM "public"."zones" WHERE "city_id" = ${cityId} ORDER BY "key"`;
    return rows.map((r) => fromRow(cityId, r));
  }

  async savePlacement(input: SavePlacement, tx?: Tx): Promise<ZoneRecord | null> {
    const rows = await this.db(tx).$queryRaw<ZoneRow[]>`
      UPDATE "public"."zones" SET
        "polygon" = ST_GeogFromText(${ringWkt(input.ring)}),
        "centre" = ST_SetSRID(ST_MakePoint(${input.centre.lng}, ${input.centre.lat}), 4326)::geography,
        "placement" = 'placed', "placed_at" = ${input.placedAt}, "placed_by_id" = ${input.placedById}, "updated_at" = ${input.placedAt}
      WHERE "city_id" = ${input.cityId} AND "key" = ${input.key}
      RETURNING ${COLUMNS}`;
    return rows[0] ? fromRow(input.cityId, rows[0]) : null;
  }
}
