import { randomUUID } from 'node:crypto';
import { Prisma } from '@driver/db';
import { DoorSample, LandmarkCategory, LatLng, type Place, type SavedPlaceLabel } from '@driver/contracts';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import type { Tx } from '../../shared/db/unit-of-work.js';
import type { SavedPlaceRecord, SavedPlacesRepository } from './saved-places.service.js';
import { distanceKm } from './zones.js';

/**
 * Learned places and the landmark layer (`places` rows with no `label`, photos in `place_photos`).
 * Customers' saved places share the table (`label` set) and have their own repository below.
 */
export interface PlacesRepository {
  save(input: Omit<Place, 'id'>): Promise<Place>;
  get(id: string): Promise<Place | null>;
  setConfidence(id: string, confidence: number): Promise<Place | null>;
  /** The city's approved landmark places (a row proposed or rejected is not one yet). */
  landmarks(cityId: string): Promise<Place[]>;
  /** Within `radiusKm` of `pin`, nearest first. */
  nearby(cityId: string, pin: LatLng, radiusKm: number): Promise<Array<Place & { distanceKm: number }>>;
  /**
   * W7 account deletion: the places this person put on the map. An approved landmark stays for
   * everyone, with no owner; anything else he proposed goes, with its photos. Idempotent.
   */
  releaseOwner(personId: string): Promise<void>;
}

export const PLACES_REPOSITORY = Symbol('PLACES_REPOSITORY');

export class InMemoryPlacesRepository implements PlacesRepository {
  private readonly places = new Map<string, Place>();
  private seq = 0;

  async save(input: Omit<Place, 'id'>): Promise<Place> {
    this.seq += 1;
    const place: Place = structuredClone({ ...input, id: `pl_${this.seq}` });
    this.places.set(place.id, place);
    return structuredClone(place);
  }

  async get(id: string): Promise<Place | null> {
    const p = this.places.get(id);
    return p ? structuredClone(p) : null;
  }

  async setConfidence(id: string, confidence: number): Promise<Place | null> {
    const p = this.places.get(id);
    if (!p) return null;
    p.confidence = confidence;
    return structuredClone(p);
  }

  async landmarks(cityId: string): Promise<Place[]> {
    return [...this.places.values()].filter((p) => p.cityId === cityId && p.landmark && (p.landmarkState ?? 'approved') === 'approved').map((p) => structuredClone(p));
  }

  async nearby(cityId: string, pin: LatLng, radiusKm: number): Promise<Array<Place & { distanceKm: number }>> {
    return [...this.places.values()]
      .filter((p) => p.cityId === cityId)
      .map((p) => ({ ...structuredClone(p), distanceKm: distanceKm(pin, p.pin) }))
      .filter((p) => p.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  async releaseOwner(personId: string): Promise<void> {
    for (const [id, p] of [...this.places]) {
      if (p.ownerId !== personId) continue;
      if (p.landmark && (p.landmarkState ?? 'approved') === 'approved') delete p.ownerId;
      else this.places.delete(id);
    }
  }
}

// ───────────────────────── Prisma ─────────────────────────

const point = (p: LatLng) => Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;

interface PlaceRow {
  id: string;
  city_id: string;
  owner_id: string | null;
  name: string;
  note: string | null;
  lat: number;
  lng: number;
  confidence: number;
  landmark: boolean;
  landmark_state: string | null;
  landmark_category: string | null;
  shares: string[];
  distance_m?: number;
}

/** A stored landmark state the contract knows; anything else reads as absent. */
function landmarkStateOf(raw: string | null): Place['landmarkState'] {
  return raw === 'proposed' || raw === 'approved' || raw === 'rejected' ? raw : undefined;
}

const PLACE_COLUMNS = Prisma.sql`"id", "city_id", "owner_id", "name", "note", ST_Y("pin"::geometry) AS lat, ST_X("pin"::geometry) AS lng, "confidence", "landmark", "landmark_state", "landmark_category", "shares"`;

export class PrismaPlacesRepository implements PlacesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Tx {
    return this.prisma.prisma as unknown as Tx;
  }

  private async withPhotos(rows: PlaceRow[]): Promise<Place[]> {
    const photos = rows.length
      ? await this.db.placePhoto.findMany({ where: { placeId: { in: rows.map((r) => r.id) } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      : [];
    return rows.map((r) => {
      const category = LandmarkCategory.safeParse(r.landmark_category).data;
      const state = landmarkStateOf(r.landmark_state);
      return {
        id: r.id,
        cityId: r.city_id,
        pin: { lat: Number(r.lat), lng: Number(r.lng) },
        name: r.name,
        ...(r.note !== null ? { note: r.note } : {}),
        photos: photos.filter((p) => p.placeId === r.id).map((p) => ({ id: p.id, url: p.url, ...(p.caption !== null ? { caption: p.caption } : {}) })),
        confidence: Number(r.confidence),
        ...(r.owner_id !== null ? { ownerId: r.owner_id } : {}),
        sharedWith: r.shares,
        landmark: r.landmark,
        ...(category ? { landmarkCategory: category } : {}),
        ...(state ? { landmarkState: state } : {}),
      };
    });
  }

  async save(input: Omit<Place, 'id'>): Promise<Place> {
    const id = `pl_${randomUUID().replaceAll('-', '')}`;
    await this.prisma.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "public"."places" ("id", "city_id", "owner_id", "name", "note", "pin", "confidence", "landmark", "landmark_state", "landmark_category", "shares", "updated_at")
        VALUES (${id}, ${input.cityId}, ${input.ownerId ?? null}, ${input.name}, ${input.note ?? null}, ${point(input.pin)}, ${input.confidence},
                ${input.landmark}, ${input.landmark ? (input.landmarkState ?? 'approved') : null}, ${input.landmark ? (input.landmarkCategory ?? null) : null}, ${input.sharedWith}::text[], now())`;
      if (input.photos.length) await tx.placePhoto.createMany({ data: input.photos.map((p) => ({ placeId: id, url: p.url, caption: p.caption ?? null })) });
    });
    return (await this.get(id))!;
  }

  async get(id: string): Promise<Place | null> {
    const rows = await this.db.$queryRaw<PlaceRow[]>`SELECT ${PLACE_COLUMNS} FROM "public"."places" WHERE "id" = ${id} AND "label" IS NULL`;
    return rows.length ? (await this.withPhotos(rows))[0]! : null;
  }

  async setConfidence(id: string, confidence: number): Promise<Place | null> {
    const n = await this.db.$executeRaw`UPDATE "public"."places" SET "confidence" = ${confidence}, "updated_at" = now() WHERE "id" = ${id} AND "label" IS NULL`;
    return n ? this.get(id) : null;
  }

  async landmarks(cityId: string): Promise<Place[]> {
    const rows = await this.db.$queryRaw<PlaceRow[]>`
      SELECT ${PLACE_COLUMNS} FROM "public"."places"
      WHERE "city_id" = ${cityId} AND "landmark" AND "landmark_state" = 'approved' AND "label" IS NULL ORDER BY "name", "id"`;
    return this.withPhotos(rows);
  }

  async nearby(cityId: string, pin: LatLng, radiusKm: number): Promise<Array<Place & { distanceKm: number }>> {
    const rows = await this.db.$queryRaw<PlaceRow[]>`
      SELECT ${PLACE_COLUMNS}, ST_Distance("pin", ${point(pin)}) AS distance_m
      FROM "public"."places"
      WHERE "city_id" = ${cityId} AND "label" IS NULL AND ST_DWithin("pin", ${point(pin)}, ${radiusKm * 1000})
      ORDER BY distance_m, "id"`;
    const places = await this.withPhotos(rows);
    return places.map((p, i) => ({ ...p, distanceKm: Number(rows[i]!.distance_m) / 1000 }));
  }

  async releaseOwner(personId: string): Promise<void> {
    const mine = Prisma.sql`"owner_id" = ${personId} AND "label" IS NULL`;
    const kept = Prisma.sql`"landmark" AND COALESCE("landmark_state", 'approved') = 'approved'`;
    await this.db.$executeRaw`DELETE FROM "public"."place_photos" WHERE "place_id" IN (SELECT "id" FROM "public"."places" WHERE ${mine} AND NOT (${kept}))`;
    await this.db.$executeRaw`DELETE FROM "public"."places" WHERE ${mine} AND NOT (${kept})`;
    await this.db.$executeRaw`UPDATE "public"."places" SET "owner_id" = NULL WHERE ${mine}`;
  }
}

interface SavedRow {
  id: string;
  owner_id: string;
  city_id: string;
  label: string;
  name: string;
  zone_key: string;
  lat: number;
  lng: number;
  note: string | null;
  photo_refs: string[];
  arrival_samples: unknown;
  entrance: unknown;
  landmark_id: string | null;
  confidence: number;
  confirmed_at: Date | null;
  share_with_household: boolean;
  client_ref: string | null;
  created_at: Date;
  updated_at: Date;
}

const SAVED_COLUMNS = Prisma.sql`"id", "owner_id", "city_id", "label", "name", "zone_key", ST_Y("pin"::geometry) AS lat, ST_X("pin"::geometry) AS lng,
  "note", "photo_refs", "arrival_samples", "entrance", "landmark_id", "confidence", "confirmed_at", "share_with_household", "client_ref", "created_at", "updated_at"`;

/** Stored arrival samples; an entry that no longer parses (older shape) is left out, never fatal. */
function samplesOf(raw: unknown): DoorSample[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x) => {
    const p = DoorSample.safeParse(x);
    return p.success ? [p.data] : [];
  });
}

function savedFromRow(r: SavedRow): SavedPlaceRecord {
  return {
    id: r.id,
    ownerId: r.owner_id,
    cityId: r.city_id,
    label: r.label as SavedPlaceLabel,
    name: r.name,
    zoneId: r.zone_key,
    pin: { lat: Number(r.lat), lng: Number(r.lng) },
    note: r.note,
    photoIds: r.photo_refs,
    arrivalSamples: samplesOf(r.arrival_samples),
    entrance: LatLng.safeParse(r.entrance).data ?? null,
    landmarkId: r.landmark_id,
    confidence: Number(r.confidence),
    confirmedAt: r.confirmed_at,
    shareWithHousehold: r.share_with_household,
    clientRef: r.client_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Customers' saved places: `places` rows with a `label` (pin as geography, photos as upload refs). */
export class PrismaSavedPlacesRepository implements SavedPlacesRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get db(): Tx {
    return this.prisma.prisma as unknown as Tx;
  }

  async get(id: string): Promise<SavedPlaceRecord | null> {
    const rows = await this.db.$queryRaw<SavedRow[]>`SELECT ${SAVED_COLUMNS} FROM "public"."places" WHERE "id" = ${id} AND "label" IS NOT NULL`;
    return rows[0] ? savedFromRow(rows[0]) : null;
  }

  async byOwners(ownerIds: readonly string[]): Promise<SavedPlaceRecord[]> {
    if (ownerIds.length === 0) return [];
    const rows = await this.db.$queryRaw<SavedRow[]>`
      SELECT ${SAVED_COLUMNS} FROM "public"."places"
      WHERE "owner_id" IN (${Prisma.join([...new Set(ownerIds)])}) AND "label" IS NOT NULL
      ORDER BY "created_at", "id"`;
    return rows.map(savedFromRow);
  }

  async put(rec: SavedPlaceRecord): Promise<void> {
    await this.db.$executeRaw`
      INSERT INTO "public"."places" ("id", "city_id", "owner_id", "name", "note", "pin", "confidence", "label", "zone_key", "photo_refs",
                                     "entrance", "landmark_id", "confirmed_at", "share_with_household", "client_ref", "created_at", "updated_at")
      VALUES (${rec.id}, ${rec.cityId}, ${rec.ownerId}, ${rec.name}, ${rec.note}, ${point(rec.pin)}, ${rec.confidence}, ${rec.label}, ${rec.zoneId},
              ${rec.photoIds}::text[], ${rec.entrance ? JSON.stringify(rec.entrance) : null}::jsonb, ${rec.landmarkId}, ${rec.confirmedAt}, ${rec.shareWithHousehold}, ${rec.clientRef}, ${rec.createdAt}, ${rec.updatedAt})
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name", "note" = EXCLUDED."note", "pin" = EXCLUDED."pin", "confidence" = EXCLUDED."confidence",
        "label" = EXCLUDED."label", "zone_key" = EXCLUDED."zone_key", "photo_refs" = EXCLUDED."photo_refs", "entrance" = EXCLUDED."entrance", "landmark_id" = EXCLUDED."landmark_id",
        "confirmed_at" = EXCLUDED."confirmed_at", "share_with_household" = EXCLUDED."share_with_household",
        "updated_at" = EXCLUDED."updated_at"
      WHERE "places"."owner_id" = EXCLUDED."owner_id"`;
  }

  async setArrivalSamples(id: string, samples: readonly DoorSample[]): Promise<void> {
    await this.db.$executeRaw`UPDATE "public"."places" SET "arrival_samples" = ${JSON.stringify(samples)}::jsonb WHERE "id" = ${id} AND "label" IS NOT NULL`;
  }

  async delete(id: string): Promise<void> {
    await this.db.$executeRaw`DELETE FROM "public"."places" WHERE "id" = ${id} AND "label" IS NOT NULL`;
  }

  async deleteOwner(ownerId: string): Promise<void> {
    await this.db.$executeRaw`DELETE FROM "public"."places" WHERE "owner_id" = ${ownerId} AND "label" IS NOT NULL`;
  }
}
