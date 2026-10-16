import { Inject, Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import {
  DOOR_RULES,
  DriverError,
  PLACE_AGREE_RADIUS_M,
  PLACE_CONFIRM_MAX_ACCURACY_M,
  PLACE_CONFIRMED_CONFIDENCE,
  PLACE_ENTRANCE_MAX_M,
  PLACE_LANDMARK_MAX_M,
  type ConfirmPlaceInput,
  type DoorSample,
  type LandmarkNearView,
  type LandmarkView,
  type LatLng,
  type Place,
  type PlaceLandmark,
  type SavedPlaceLabel,
  type SavedPlaceView,
  type SavePlaceInput,
  type UpdatePlaceInput,
} from '@driver/contracts';
import { z } from 'zod';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { isUniqueViolation } from '../../shared/db/unique-violation.js';
import { EventsService } from '../events/index.js';
import { doorPoint, withSample } from './door-point.js';
import { cityLandmarks, nearestLandmarks } from './landmarks.js';
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
  /** Couriers' arrival fixes at delivered drop-offs (maps program a3), newest `DOOR_RULES.keep`. */
  arrivalSamples: DoorSample[];
  /** Which gate couriers go in by (maps program a4), within `PLACE_ENTRANCE_MAX_M` of the pin. */
  entrance: LatLng | null;
  /** The landmark it is near (maps program a2): a `cityLandmarks` id within `PLACE_LANDMARK_MAX_M` of the pin. */
  landmarkId: string | null;
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
  /** Writes the place's arrival samples only (never races an owner's edit of the rest). */
  setArrivalSamples(id: string, samples: readonly DoorSample[]): Promise<void>;
  put(rec: SavedPlaceRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export const SAVED_PLACES_REPOSITORY = Symbol('SAVED_PLACES_REPOSITORY');
/**
 * The city's approved landmark places (`PlacesService.landmarks`, narrow), merged with the seed by
 * `cityLandmarks`. Absent in tests that do not need them: the seed alone.
 */
export const LEARNED_LANDMARKS = Symbol('LEARNED_LANDMARKS');
export interface LearnedLandmarks {
  landmarks(cityId: string): Promise<Place[]>;
}

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
    // Like the database: an edit never writes the arrival samples (they have their own writer).
    const samples = this.rows.get(rec.id)?.arrivalSamples ?? rec.arrivalSamples;
    this.rows.set(rec.id, structuredClone({ ...rec, arrivalSamples: samples }));
  }

  async setArrivalSamples(id: string, samples: readonly DoorSample[]) {
    const r = this.rows.get(id);
    if (r) r.arrivalSamples = structuredClone([...samples]);
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

const samePoint = (a: LatLng | null, b: LatLng | null): boolean => a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);

/** A marked gate, refused when it is too far from the pin to be this house's (maps program a4). */
function entranceNear(pin: LatLng, entrance: LatLng | null): LatLng | null {
  if (!entrance) return null;
  if (distanceM(pin, entrance) > PLACE_ENTRANCE_MAX_M) throw new DriverError('place_entrance_too_far');
  return entrance;
}

/** A landmark's names for a place and its courier; null when none was chosen or it is gone. */
function landmarkOf(all: readonly LandmarkView[], id: string | null): PlaceLandmark | null {
  const l = id ? all.find((x) => x.id === id) : undefined;
  return l ? { id: l.id, name_ar: l.name_ar, name_en: l.name_en } : null;
}

/** Subscriber name for the door learning (maps program a3). */
export const PLACES_DOOR_SUBSCRIBER = 'places:door-learning';

/** The `door` part of a `stop.completed` payload (trips adds it for drop-offs at saved places). */
const DoorPayload = z.object({ stopId: z.string(), door: z.object({ placeId: z.string(), courierId: z.string(), lat: z.number(), lng: z.number(), accuracyM: z.number().min(0) }) });

/**
 * Customers' saved places (domain §7, customer spec §10): owner-only writes, zone resolved from the
 * pin on the server, photos referenced by finished uploads the owner made, "موقعي هنا" confirmation,
 * and opt-in household sharing (read-only for the other members).
 */
@Injectable()
export class SavedPlacesService implements OnModuleInit {
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
    @Optional() @Inject(LEARNED_LANDMARKS) private readonly learned?: LearnedLandmarks,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  /** Delivered drop-offs at saved places teach them their door (maps program a3), through the outbox. */
  onModuleInit(): void {
    this.events?.subscribe(PLACES_DOOR_SUBSCRIBER, ['stop.completed'], async (e) => {
      if (e.quarantined) return;
      const p = DoorPayload.safeParse(e.payload);
      // Pickups, rides and drop-offs without a saved place or a precise arrival carry no door.
      if (!p.success) return;
      const { door, stopId } = p.data;
      await this.learnDoor(door.placeId, { stopId, courierId: door.courierId, lat: door.lat, lng: door.lng, accuracyM: door.accuracyM, at: e.occurredAt });
    });
  }

  /** The pins of the person's own saved home(s): the referral fingerprint's «same home» (decisions §1). */
  async homePins(personId: string): Promise<LatLng[]> {
    return (await this.repo.byOwners([personId])).filter((r) => r.ownerId === personId && r.label === 'home').map((r) => r.pin);
  }

  /** Mine first (home, work, then by name), then places household members shared with me. */
  async mine(personId: string): Promise<SavedPlaceView[]> {
    const peers = await this.peers.peersOf(personId);
    const rows = await this.repo.byOwners([personId, ...peers]);
    const visible = rows.filter((r) => r.ownerId === personId || r.shareWithHousehold);
    const order = (r: SavedPlaceRecord) => (r.ownerId === personId ? 0 : 10) + (r.label === 'home' ? 0 : r.label === 'work' ? 1 : 2);
    visible.sort((a, b) => order(a) - order(b) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    return this.viewsOf(visible, personId);
  }

  async save(personId: string, input: z.infer<typeof SavePlaceInput>): Promise<SavedPlaceView> {
    if (input.clientRef) {
      const existing = (await this.repo.byOwners([personId])).find((r) => r.clientRef === input.clientRef);
      if (existing) return this.viewOf(existing, personId);
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
      arrivalSamples: [],
      entrance: entranceNear(input.pin, input.entrance ?? null),
      landmarkId: input.landmarkId ? (await this.landmarkNear(input.cityId, input.pin, input.landmarkId)).id : null,
      confidence: INITIAL_CONFIDENCE,
      confirmedAt: null,
      shareWithHousehold: input.shareWithHousehold,
      clientRef: input.clientRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await this.repo.put(rec);
    } catch (err) {
      // A double tap raced this save past the check above (RDB-04): the first save stands.
      const winner = input.clientRef && isUniqueViolation(err) ? (await this.repo.byOwners([personId])).find((r) => r.clientRef === input.clientRef) : undefined;
      if (!winner) throw err;
      // This twin's label demote may have run after the winner was written: give it its label back.
      if (winner.label !== input.label) await this.repo.put({ ...winner, label: input.label, updatedAt: now });
      return this.viewOf({ ...winner, label: input.label }, personId);
    }
    this.emit('place.saved', personId, { placeId: rec.id, ownerId: personId, cityId: rec.cityId, zoneId, label: rec.label, photos: photoIds.length, shared: rec.shareWithHousehold }, rec.id);
    if (rec.shareWithHousehold) this.emit('place.shared', personId, { placeId: rec.id, ownerId: personId, scope: 'household' }, rec.id);
    return this.viewOf(rec, personId);
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
    let forgetDoor = false;
    if (input.pin) {
      const moved = distanceM(rec.pin, input.pin);
      rec.zoneId = this.zoneOrThrow(rec.cityId, input.pin);
      rec.pin = input.pin;
      // A pin moved by hand is a new claim: the old confirmation, and the door couriers learned
      // for the old spot (maps a3), no longer vouch for it.
      if (moved > PLACE_AGREE_RADIUS_M) {
        rec.confidence = INITIAL_CONFIDENCE;
        rec.confirmedAt = null;
        forgetDoor = true;
      }
    }
    // Checked against the pin after this edit, and before photos are let go: a refused landmark
    // leaves the place as it was.
    if (input.landmarkId !== undefined) rec.landmarkId = input.landmarkId === null ? null : (await this.landmarkNear(rec.cityId, rec.pin, input.landmarkId)).id;
    else if (input.pin) await this.forgetFarLandmark(rec);
    // A gate the owner changes must be near the house; an unchanged one sent back with a moved pin is
    // simply dropped below when the house moved too far from it.
    if (input.entrance !== undefined && !samePoint(input.entrance, rec.entrance)) rec.entrance = entranceNear(rec.pin, input.entrance);
    // The house moved: a gate left far behind belongs to the old one.
    if (rec.entrance && distanceM(rec.pin, rec.entrance) > PLACE_ENTRANCE_MAX_M) rec.entrance = null;
    // Photos are checked here but let go only once the edit is saved: a refused edit deletes nothing.
    const dropped = input.photoIds ? rec.photoIds : [];
    if (input.photoIds) rec.photoIds = await this.ownUploads(personId, input.photoIds, rec.photoIds);
    const startedSharing = input.shareWithHousehold === true && !rec.shareWithHousehold;
    if (input.shareWithHousehold !== undefined) rec.shareWithHousehold = input.shareWithHousehold;
    rec.updatedAt = now;
    await this.repo.put(rec);
    for (const old of dropped) if (!rec.photoIds.includes(old)) await this.blobs.remove(old);
    if (forgetDoor) await this.repo.setArrivalSamples(rec.id, []);
    this.emit('place.updated', personId, { placeId: rec.id, ownerId: personId, zoneId: rec.zoneId, label: rec.label, photos: rec.photoIds.length, shared: rec.shareWithHousehold }, rec.id);
    if (startedSharing) this.emit('place.shared', personId, { placeId: rec.id, ownerId: personId, scope: 'household' }, rec.id);
    return this.viewOf(rec, personId);
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
      if (rec.entrance && distanceM(rec.pin, rec.entrance) > PLACE_ENTRANCE_MAX_M) rec.entrance = null;
      await this.forgetFarLandmark(rec);
      rec.confidence = OWNER_MOVE_CONFIDENCE;
    } else {
      rec.confidence = Math.max(rec.confidence, OWNER_AGREE_CONFIDENCE);
    }
    rec.confirmedAt = now;
    rec.updatedAt = now;
    await this.repo.put(rec);
    // Standing somewhere else: the door couriers learned belongs to the old spot (maps a3).
    if (moved) await this.repo.setArrivalSamples(rec.id, []);
    this.emit('place.confirmed', personId, { placeId: rec.id, ownerId: personId, by: 'owner', moved, distanceM: Math.round(d), zoneId: rec.zoneId, confidence: rec.confidence }, rec.id);
    return this.viewOf(rec, personId);
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
   * The place an order goes to, when the orderer may use it (maps program SP3d): its learned door
   * (a3), where the courier navigates and arrives; null when the place is not theirs or gone.
   */
  async deliveryPlace(personId: string, placeId: string): Promise<{ door: LatLng | null } | null> {
    if (!(await this.usableBy(personId, placeId))) return null;
    const r = await this.repo.get(placeId);
    // The gate the owner marked comes first; else the door couriers' arrivals agree on.
    return r ? { door: r.entrance ?? doorPoint(r.arrivalSamples, r.pin) } : null;
  }

  /**
   * The door as the courier on the job sees it (maps program f6): the place's standing note and its
   * photos as signed links — only for the assigned courier, from accepting until an hour after the
   * trip (domain §7, `courierMaySeePlaceDetails`); null otherwise or when the place is gone.
   */
  async courierDoor(
    placeId: string,
    input: Parameters<typeof courierMaySeePlaceDetails>[0],
  ): Promise<{ placeNote: string | null; photos: Array<{ id: string; url: string }>; doorConfirmed: boolean; entranceSet: boolean; landmark: string | null } | null> {
    if (!courierMaySeePlaceDetails(input)) return null;
    const r = await this.repo.get(placeId);
    if (!r) return null;
    // «قرب الجامع الكبير» (a2): couriers here find a house by its landmark, so its Arabic name.
    const landmark = r.landmarkId ? (landmarkOf(await this.landmarks(r.cityId), r.landmarkId)?.name_ar ?? null) : null;
    return { placeNote: r.note, photos: r.photoIds.map((id) => ({ id, url: this.blobs.readUrl(id) })), doorConfirmed: doorPoint(r.arrivalSamples, r.pin) !== null, entranceSet: r.entrance !== null, landmark };
  }

  /**
   * One delivered arrival at a saved place (maps program a3, from `stop.completed`). Why only
   * precise ones: a fix blurrier than `DOOR_RULES.maxAccuracyM` would teach the wrong door. A
   * redelivered event adds nothing (one sample per drop-off). Returns whether it was kept.
   */
  async learnDoor(placeId: string, sample: DoorSample): Promise<boolean> {
    if (sample.accuracyM > DOOR_RULES.maxAccuracyM) return false;
    const r = await this.repo.get(placeId);
    if (!r || r.arrivalSamples.some((s) => s.stopId === sample.stopId)) return false;
    await this.repo.setArrivalSamples(placeId, withSample(r.arrivalSamples, sample));
    return true;
  }

  /** The city's landmarks (`cityLandmarks`): the seed plus approved landmark places, zones from the pins. */
  async landmarks(cityId: string): Promise<LandmarkView[]> {
    return cityLandmarks(cityId, (await this.learned?.landmarks(cityId)) ?? [], (pin) => this.zones.resolve(cityId, pin));
  }

  /** "قرب شنو؟" (maps program a2): what the place editor offers as chips for this pin. */
  async landmarksNear(cityId: string, pin: LatLng): Promise<LandmarkNearView[]> {
    return nearestLandmarks(await this.landmarks(cityId), pin);
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

  /**
   * The landmark a place may say it is near (a2): a known one within `PLACE_LANDMARK_MAX_M` of the
   * pin. Why the server checks: an app could send any id, and a far "قرب" sends the courier astray.
   */
  private async landmarkNear(cityId: string, pin: LatLng, landmarkId: string): Promise<LandmarkView> {
    const l = (await this.landmarks(cityId)).find((x) => x.id === landmarkId);
    if (!l || distanceM(pin, l.pin) > PLACE_LANDMARK_MAX_M) throw new DriverError('place_landmark_invalid');
    return l;
  }

  /**
   * The house moved: a landmark now far from it describes the old spot. One that is gone stays
   * stored (an approved landmark can come back) and simply does not show.
   */
  private async forgetFarLandmark(rec: SavedPlaceRecord): Promise<void> {
    if (!rec.landmarkId) return;
    const l = (await this.landmarks(rec.cityId)).find((x) => x.id === rec.landmarkId);
    if (l && distanceM(rec.pin, l.pin) > PLACE_LANDMARK_MAX_M) rec.landmarkId = null;
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

  /** Views with their landmarks; the city's landmarks are read once, and only when a place has one. */
  private async viewsOf(rows: readonly SavedPlaceRecord[], viewerId: string): Promise<SavedPlaceView[]> {
    const byCity = new Map<string, LandmarkView[]>();
    for (const cityId of new Set(rows.filter((r) => r.landmarkId).map((r) => r.cityId))) byCity.set(cityId, await this.landmarks(cityId));
    return rows.map((r) => this.view(r, viewerId, landmarkOf(byCity.get(r.cityId) ?? [], r.landmarkId)));
  }

  private async viewOf(r: SavedPlaceRecord, viewerId: string): Promise<SavedPlaceView> {
    return this.view(r, viewerId, r.landmarkId ? landmarkOf(await this.landmarks(r.cityId), r.landmarkId) : null);
  }

  private view(r: SavedPlaceRecord, viewerId: string, landmark: PlaceLandmark | null): SavedPlaceView {
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
      doorConfirmed: doorPoint(r.arrivalSamples, r.pin) !== null,
      entrance: r.entrance,
      landmark,
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
