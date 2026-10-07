import { createHash } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { LANDMARK_FEED_RULES, type LandmarkFeed, type LandmarkFeedInput, type LandmarkFeedItem, type LandmarkView } from '@driver/contracts';
import type { z } from 'zod';
import { CLOCK, SystemClock, type Clock } from '../../shared/clock.js';
import { SavedPlacesService } from './saved-places.service.js';
import { BLOB_STORE, type BlobStore } from './uploads.js';

const DAY_MS = 86_400_000;
/** Seeded landmarks' ids are `lm_<seed key>`; a field-ops photo may name the seed key itself. */
const SEED_PREFIX = 'lm_';

/**
 * Approved landmark photos (`landmark_photos`, owned by the ops module, which registers itself with
 * `LandmarkFeedService.usePhotos` — places never imports ops, ops already imports places).
 */
export interface ApprovedLandmarkPhotos {
  /** The newest approved photo's upload id for each of these targets that has one. */
  latestApproved(targetIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Where a landmark's photo comes from: the place's own photo link, or an approved upload to sign. */
export type FeedPhoto = { url: string } | { uploadId: string } | null;

/** The place's own photo first; else the newest approved upload for its id (or, for a seed, its key). */
export function feedPhotoOf(view: LandmarkView, approved: ReadonlyMap<string, string>): FeedPhoto {
  if (view.photoUrl) return { url: view.photoUrl };
  const uploadId = approved.get(view.id) ?? (view.id.startsWith(SEED_PREFIX) ? approved.get(view.id.slice(SEED_PREFIX.length)) : undefined);
  return uploadId ? { uploadId } : null;
}

/** The targets a field-ops photo may name for these landmarks (ids, and seeds' bare keys). */
export function photoTargetsOf(views: readonly LandmarkView[]): string[] {
  return views.flatMap((v) => (v.id.startsWith(SEED_PREFIX) ? [v.id, v.id.slice(SEED_PREFIX.length)] : [v.id]));
}

/**
 * The feed's etag: a short hash of what a map draws — ids, names, categories, pins (6 decimals) and
 * which photo (the upload id, never the signed link, which changes every hour). When any photo is a
 * signed link, the day joins in, so a phone refreshes its links at least daily (they stay valid
 * `photoValidMs`, two days). Order matters: the feed's order is stable.
 */
export function landmarkFeedEtag(entries: ReadonlyArray<{ view: LandmarkView; photo: FeedPhoto }>, now: Date): string {
  const signed = entries.some((e) => e.photo !== null && 'uploadId' in e.photo);
  const body = entries.map(({ view: v, photo }) => [v.id, v.name_ar, v.category, v.pin.lat.toFixed(6), v.pin.lng.toFixed(6), photo === null ? '' : 'url' in photo ? photo.url : `u:${photo.uploadId}`]);
  const day = signed ? Math.floor(now.getTime() / DAY_MS) : null;
  return createHash('sha1').update(JSON.stringify([body, day])).digest('base64url').slice(0, 20);
}

interface BuiltFeed {
  at: number;
  etag: string;
  items: LandmarkFeedItem[];
}

/**
 * The map's landmark layer (maps program b3): the city's landmarks — the seed plus approved landmark
 * places, exactly the list «وين رايح؟» searches (`SavedPlacesService.landmarks`) — as icons with a
 * category and an optional approved photo. Built at most every `serverTtlMs` per city (approving a
 * photo drops it at once); a phone sending the current etag gets `changed: false` only.
 */
@Injectable()
export class LandmarkFeedService {
  private readonly clock: Clock;
  private readonly built = new Map<string, BuiltFeed>();
  private photos: ApprovedLandmarkPhotos | null = null;

  constructor(
    private readonly saved: SavedPlacesService,
    @Inject(BLOB_STORE) private readonly blobs: BlobStore,
    @Optional() @Inject(CLOCK) clock?: Clock,
  ) {
    this.clock = clock ?? new SystemClock();
  }

  /** The ops module's approved photos (at start-up). */
  usePhotos(source: ApprovedLandmarkPhotos): void {
    this.photos = source;
    this.invalidate();
  }

  /** Drops the built feed (a city's, or every city's): the next ask rebuilds it. */
  invalidate(cityId?: string): void {
    if (cityId) this.built.delete(cityId);
    else this.built.clear();
  }

  async feed(input: z.output<typeof LandmarkFeedInput>): Promise<LandmarkFeed> {
    const feed = await this.current(input.cityId);
    const maxAgeS = LANDMARK_FEED_RULES.maxAgeS;
    return input.etag === feed.etag ? { changed: false, etag: feed.etag, maxAgeS } : { changed: true, etag: feed.etag, maxAgeS, landmarks: feed.items };
  }

  private async current(cityId: string): Promise<BuiltFeed> {
    const now = this.clock.now();
    const cached = this.built.get(cityId);
    if (cached && now.getTime() - cached.at < LANDMARK_FEED_RULES.serverTtlMs) return cached;
    const views = await this.saved.landmarks(cityId);
    const approved = this.photos ? await this.photos.latestApproved(photoTargetsOf(views)) : new Map<string, string>();
    const entries = views.map((view) => ({ view, photo: feedPhotoOf(view, approved) }));
    const items: LandmarkFeedItem[] = entries.map(({ view, photo }) => ({
      id: view.id,
      name_ar: view.name_ar,
      category: view.category,
      pin: { lat: view.pin.lat, lng: view.pin.lng },
      photoUrl: photo === null ? null : 'url' in photo ? photo.url : this.blobs.readUrl(photo.uploadId, LANDMARK_FEED_RULES.photoValidMs),
    }));
    const feed = { at: now.getTime(), etag: landmarkFeedEtag(entries, now), items };
    this.built.set(cityId, feed);
    return feed;
  }
}
