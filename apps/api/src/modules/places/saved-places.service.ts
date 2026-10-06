import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DriverError,
  PLACE_AGREE_RADIUS_M,
  PLACE_CONFIRM_MAX_ACCURACY_M,
  PLACE_CONFIRMED_CONFIDENCE,
  type ConfirmPlaceInput,
  type LatLng,
  type SavedPlaceLabel,
  type SavedPlaceView,
  type SavePlaceInput,
  type UpdatePlaceInput,
} from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { EventsService } from '../events/index.js';
import { BLOB_STORE, type BlobStore } from './uploads.js';
import { distanceM, ZoneResolver } from './zones.js';

export interface SavedPlaceRecord {
  id: string;
  ownerId: string;
  cityId: string;
  label: SavedPlaceLabel;
  name: string;
  zoneId: string;
  pin: LatLng;
  note: string | null;
  photoIds: string[];
  confidence: number;
  confirmedAt: Date | null;
  shareWithHousehold: boolean;
  clientRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Persistence port for customers' saved places. In-memory for now: the Prisma `places` table has no
 * label / zone / confirmedAt / clientRef columns yet, and photos belong in the vault bucket (domain §13).
 */
export interface SavedPlacesRepository {
  get(id: string): Promise<SavedPlaceRecord | null>;
  byOwners(ownerIds: readonly string[]): Promise<SavedPlaceRecord[]>;
  put(rec: SavedPlaceRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export const SAVED_PLACES_REPOSITORY = Symbol('SAVED_PLACES_REPOSITORY');
/** Who shares a household with whom (orgs module, narrow): the people whose shared places I may see. */
export const HOUSEHOLD_PEERS = Symbol('HOUSEHOLD_PEERS');
export interface HouseholdPeers {
  /** Everyone in any household with this person, excluding the person. */
  peersOf(personId: string): Promise<string[]> | string[];
}

export class InMemorySavedPlacesRepository implements SavedPlacesRepository {
  private readonly rows = new Map<string, SavedPlaceRecord>();

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? structuredClone(r) : null;
  }

  async byOwners(ownerIds: readonly string[]) {
    const set = new Set(ownerIds);
    return [...this.rows.values()].filter((r) => set.has(r.ownerId)).map((r) => structuredClone(r));
  }

  async put(rec: SavedPlaceRecord) {
    this.rows.set(rec.id, structuredClone(rec));
  }

  async delete(id: string) {
    this.rows.delete(id);
  }
}

/** New saved places start unconfirmed; the owner's on-site GPS or courier taps raise it (domain §7). */
export const INITIAL_CONFIDENCE = 0.5;
/** The owner's own GPS fix far from the saved pin: the pin moves there, confirmed but below an agreeing fix. */
export const OWNER_MOVE_CONFIDENCE = PLACE_CONFIRMED_CONFIDENCE;
export const OWNER_AGREE_CONFIDENCE = 0.85;

/**
 * Domain §7 visibility for couriers: the note and photos of a customer's place are shown only to the
 * courier assigned to the trip, from `accepted` until one hour after `completed`, and never in history.
 */
export function courierMaySeePlaceDetails(input: {
  courierId: string;
  trip: { courierId: string | null; acceptedAt: Date | null; completedAt: Date | null; cancelled?: boolean };
  now: Date;
}): boolean {
  const { trip } = input;
  if (!trip.courierId || trip.courierId !== input.courierId || !trip.acceptedAt || trip.cancelled) return false;
  if (input.now < trip.acceptedAt) return false;
  return !trip.completedAt || input.now.getTime() <= trip.completedAt.getTime() + 3_600_000;
}

/**
 * Customers' saved places (domain §7, customer spec §10): owner-only writes, zone resolved from the
 * pin on the server, photos referenced by finished uploads the owner made, "موقعي هنا" confirmation,
 * and opt-in household sharing (read-only for the other members).
 */
@Injectable()
export class SavedPlacesService {
  private readonly logger = new Logger(SavedPlacesService.name);
  private readonly clock: Clock;
  private readonly inflight = new Set<Promise<void>>();
  readonly zones = new ZoneResolver();

  constructor(
    @Inject(SAVED_PLACES_REPOSITORY) private readonly repo: SavedPlacesRepository,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Inject(HOUSEHOLD_PEERS) private readonly peers: HouseholdPeers,
    @Optional() private readonly events?: EventsService,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  /** Mine first (home, work, then by name), then places household members shared with me. */
  async mine(personId: string): Promise<SavedPlaceView[]> {
    const peers = await this.peers.peersOf(personId);
    const rows = await this.repo.byOwners([personId, ...peers]);
    const visible = rows.filter((r) => r.ownerId === personId || r.shareWithHousehold);
    const order = (r: SavedPlaceRecord) => (r.ownerId === personId ? 0 : 10) + (r.label === 'home' ? 0 : r.label === 'work' ? 1 : 2);
    visible.sort((a, b) => order(a) - order(b) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return visible.map((r) => this.view(r, personId));
  }

  async save(personId: string, input: z.infer<typeof SavePlaceInput>): Promise<SavedPlaceView> {
    if (input.clientRef) {
      const existing = (await this.repo.byOwners([personId])).find((r) => r.clientRef === input.clientRef);
      if (existing) return this.view(existing, personId);
    }
    const zoneId = this.zoneOrThrow(input.cityId, input.pin);
    const photoIds = await this.ownUploads(personId, input.photoIds, []);
    const now = this.clock.now();
    await this.demoteLabel(personId, input.label, null, now);
    const rec: SavedPlaceRecord = {
      id: `sp_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      ownerId: personId,
      cityId: input.cityId,
      label: input.label,
      name: input.name.trim(),
      zoneId,
      pin: input.pin,
      note: input.note?.trim() || null,
      photoIds,
      confidence: INITIAL_CONFIDENCE,
      confirmedAt: null,
      shareWithHousehold: input.shareWithHousehold,
      clientRef: input.clientRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.put(rec);
    this.emit('place.saved', personId, { placeId: rec.id, ownerId: personId, cityId: rec.cityId, zoneId, label: rec.label, photos: photoIds.length, shared: rec.shareWithHousehold }, rec.id);
    if (rec.shareWithHousehold) this.emit('place.shared', personId, { placeId: rec.id, ownerId: personId, scope: 'household' }, rec.id);
    return this.view(rec, personId);
  }

  async update(personId: string, input: z.infer<typeof UpdatePlaceInput>): Promise<SavedPlaceView> {
    const rec = await this.owned(personId, input.placeId);
    const now = this.clock.now();
    if (input.label && input.label !== rec.label) {
      await this.demoteLabel(personId, input.label, rec.id, now);
      rec.label = input.label;
    }
    if (input.name !== undefined) rec.name = input.name.trim();
    if (input.note !== undefined) rec.note = input.note?.trim() || null;
    if (input.pin) {
      const moved = distanceM(rec.pin, input.pin);
      rec.zoneId = this.zoneOrThrow(rec.cityId, input.pin);
      rec.pin = input.pin;
      // A pin moved by hand is a new claim: the old confirmation no longer vouches for it.
      if (moved > PLACE_AGREE_RADIUS_M) {
        rec.confidence = INITIAL_CONFIDENCE;
        rec.confirmedAt = null;
      }
    }
    if (input.photoIds) {
      const next = await this.ownUploads(personId, input.photoIds, rec.photoIds);
      for (const old of rec.photoIds) if (!next.includes(old)) await this.blobs.remove(old);
      rec.photoIds = next;
    }
    const startedSharing = input.shareWithHousehold === true && !rec.shareWithHousehold;
    if (input.shareWithHousehold !== undefined) rec.shareWithHousehold = input.shareWithHousehold;
    rec.updatedAt = now;
    await this.repo.put(rec);
    this.emit('place.updated', personId, { placeId: rec.id, ownerId: personId, zoneId: rec.zoneId, label: rec.label, photos: rec.photoIds.length, shared: rec.shareWithHousehold }, rec.id);
    if (startedSharing) this.emit('place.shared', personId, { placeId: rec.id, ownerId: personId, scope: 'household' }, rec.id);
    return this.view(rec, personId);
  }

  async remove(personId: string, placeId: string): Promise<{ ok: true }> {
    const rec = await this.owned(personId, placeId);
    for (const id of rec.photoIds) await this.blobs.remove(id);
    await this.repo.delete(rec.id);
    this.emit('place.removed', personId, { placeId: rec.id, ownerId: personId }, rec.id);
    return { ok: true };
  }

  /** "موقعي هنا" (see `ConfirmPlaceInput`). */
  async confirm(personId: string, input: ConfirmPlaceInput): Promise<SavedPlaceView> {
    const rec = await this.owned(personId, input.placeId);
    if (input.accuracyM !== undefined && input.accuracyM > PLACE_CONFIRM_MAX_ACCURACY_M) throw new DriverError('location_weak');
    const now = this.clock.now();
    const d = distanceM(rec.pin, input.pin);
    const moved = d > PLACE_AGREE_RADIUS_M;
    if (moved) {
      rec.zoneId = this.zoneOrThrow(rec.cityId, input.pin);
      rec.pin = input.pin;
      rec.confidence = OWNER_MOVE_CONFIDENCE;
    } else {
      rec.confidence = Math.max(rec.confidence, OWNER_AGREE_CONFIDENCE);
    }
    rec.confirmedAt = now;
    rec.updatedAt = now;
    await this.repo.put(rec);
    this.emit('place.confirmed', personId, { placeId: rec.id, ownerId: personId, by: 'owner', moved, distanceM: Math.round(d), zoneId: rec.zoneId, confidence: rec.confidence }, rec.id);
    return this.view(rec, personId);
  }

  /**
   * Whether the person may deliver to this saved place: theirs, or one a household member shared with
   * them (maps program SP3d). Orders keep a place link only when this holds.
   */
  async usableBy(personId: string, placeId: string): Promise<boolean> {
    const r = await this.repo.get(placeId);
    if (!r) return false;
    if (r.ownerId === personId) return true;
    return r.shareWithHousehold && (await this.peers.peersOf(personId)).includes(r.ownerId);
  }

  /**
   * The door as the courier on the job sees it (maps program f6): the place's standing note and its
   * photos as signed links — only for the assigned courier, from accepting until an hour after the
   * trip (domain §7, `courierMaySeePlaceDetails`); null otherwise or when the place is gone.
   */
  async courierDoor(placeId: string, input: Parameters<typeof courierMaySeePlaceDetails>[0]): Promise<{ placeNote: string | null; photos: Array<{ id: string; url: string }> } | null> {
    if (!courierMaySeePlaceDetails(input)) return null;
    const r = await this.repo.get(placeId);
    if (!r) return null;
    return { placeNote: r.note, photos: r.photoIds.map((id) => ({ id, url: this.blobs.readUrl(id) })) };
  }

  zoneFor(cityId: string, pin: LatLng): { zoneId: string | null; zoneName_ar: string | null; zoneName_en: string | null; inService: boolean } {
    const zoneId = this.zones.resolve(cityId, pin);
    if (!zoneId) return { zoneId: null, zoneName_ar: null, zoneName_en: null, inService: false };
    const n = this.zones.names(cityId, zoneId);
    return { zoneId, zoneName_ar: n.ar, zoneName_en: n.en, inService: true };
  }

  /** Resolves when every event emitted so far has been recorded. */
  async settled(): Promise<void> {
    await Promise.all([...this.inflight]);
  }

  // ───────────────────────── internals ─────────────────────────

  private zoneOrThrow(cityId: string, pin: LatLng): string {
    const zoneId = this.zones.resolve(cityId, pin);
    if (!zoneId) throw new DriverError('outside_zone');
    return zoneId;
  }

  /** Only the owner reads-for-write; anyone else (household included) gets not-found, not forbidden. */
  private async owned(personId: string, placeId: string): Promise<SavedPlaceRecord> {
    const rec = await this.repo.get(placeId);
    if (!rec || rec.ownerId !== personId) throw new DriverError('place_not_found');
    return rec;
  }

  /** Each id must be a finished upload by this person (or already on the place). */
  private async ownUploads(personId: string, ids: readonly string[], current: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    for (const id of new Set(ids)) {
      if (current.includes(id)) {
        out.push(id);
        continue;
      }
      const rec = await this.blobs.get(id);
      if (!rec || rec.ownerId !== personId || rec.state !== 'stored') throw new DriverError('upload_invalid');
      out.push(id);
    }
    return out;
  }

  /** One home and one work per person: the older one becomes a custom place, keeping its name. */
  private async demoteLabel(personId: string, label: SavedPlaceLabel, exceptId: string | null, now: Date): Promise<void> {
    if (label === 'custom') return;
    for (const r of await this.repo.byOwners([personId])) {
      if (r.id === exceptId || r.label !== label) continue;
      r.label = 'custom';
      r.updatedAt = now;
      await this.repo.put(r);
    }
  }

  private view(r: SavedPlaceRecord, viewerId: string): SavedPlaceView {
    const names = this.zones.names(r.cityId, r.zoneId);
    return {
      id: r.id,
      cityId: r.cityId,
      label: r.label,
      name: r.name,
      zoneId: r.zoneId,
      zoneName_ar: names.ar,
      zoneName_en: names.en,
      pin: r.pin,
      note: r.note,
      photos: r.photoIds.map((id) => ({ id, url: this.blobs.readUrl(id) })),
      confidence: r.confidence,
      confirmed: r.confidence >= PLACE_CONFIRMED_CONFIDENCE,
      confirmedAt: r.confirmedAt,
      sharedWithHousehold: r.shareWithHousehold,
      access: r.ownerId === viewerId ? 'owner' : 'household',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private emit(type: string, actorId: string, payload: Record<string, unknown>, placeId: string): void {
    if (!this.events) return;
    const p = this.events
      .emit(undefined, { actorId, type, occurredAt: this.clock.now(), payload }, { name: 'place', id: placeId })
      .then(
        () => undefined,
        (err: unknown) => this.logger.error(`${type} not recorded: ${(err as Error).message}`),
      );
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }
}
