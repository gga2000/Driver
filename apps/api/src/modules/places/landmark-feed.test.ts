import { describe, expect, it } from 'vitest';
import { AZIZIYAH_LANDMARKS, LANDMARK_FEED_RULES, type LandmarkFeed, type LandmarkFeedItem, type LatLng, type Place } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { DEMO_LANDMARKS, seedDemoLandmarks } from './demo-landmarks.js';
import { feedPhotoOf, LandmarkFeedService, landmarkFeedEtag } from './landmark-feed.js';
import { PlacesService } from './places.service.js';
import { InMemorySavedPlacesRepository, SavedPlacesService } from './saved-places.service.js';
import { DevBlobStore } from './uploads.js';

const STREET_30: LatLng = { lat: 32.9095, lng: 45.0635 };
const ZAKUR: LatLng = { lat: 32.887, lng: 45.0765 };

function harness() {
  const clock = new FakeClock('2026-10-07T09:00:00Z');
  const { events } = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'test-secret' });
  const places = new PlacesService();
  const saved = new SavedPlacesService(new InMemorySavedPlacesRepository(), blobs, { peersOf: () => [] }, events, clock, places);
  const feed = new LandmarkFeedService(saved, blobs, clock);
  const approved = new Map<string, string>();
  feed.usePhotos({ latestApproved: async (ids) => new Map([...approved].filter(([k]) => ids.includes(k))) });
  const landmark = (name: string, pin: LatLng, extra: Partial<Place> = {}) =>
    places.save({ cityId: 'aziziyah', pin, name, photos: [], confidence: 1, sharedWith: [], landmark: true, ...extra });
  return { clock, places, saved, feed, approved, landmark };
}

function itemsOf(res: LandmarkFeed): LandmarkFeedItem[] {
  if (!res.changed) throw new Error('expected a full feed');
  return res.landmarks;
}

describe('LandmarkFeedService (maps program b3)', () => {
  it('the seed and approved landmark places only — never proposed or rejected ones, never saved homes', async () => {
    const h = harness();
    await h.landmark('جامع زاكور الكبير', ZAKUR, { landmarkCategory: 'mosque' });
    await h.landmark('سوك زاكور', { lat: 32.8858, lng: 45.0781 });
    await h.landmark('مدرسة مقترحة', STREET_30, { landmarkState: 'proposed' });
    await h.landmark('مستوصف مرفوض', STREET_30, { landmarkState: 'rejected' });
    await h.places.save({ cityId: 'aziziyah', pin: STREET_30, name: 'فرن تعلّم', photos: [], confidence: 0.4, sharedWith: [], landmark: false });
    await h.saved.save('cust_a', { cityId: 'aziziyah', label: 'home', name: 'البيت', pin: ZAKUR, photoIds: [], shareWithHousehold: false });

    const items = itemsOf(await h.feed.feed({ cityId: 'aziziyah' }));
    const names = items.map((i) => i.name_ar);
    expect(names).toHaveLength(AZIZIYAH_LANDMARKS.length + 2);
    expect(names).toEqual(expect.arrayContaining(['جامع زاكور الكبير', 'سوك زاكور', 'كراج البوابة 1']));
    for (const hidden of ['مدرسة مقترحة', 'مستوصف مرفوض', 'فرن تعلّم', 'البيت']) expect(names).not.toContain(hidden);
    // Only what the map needs: no owner, note, zone or kind.
    for (const i of items) expect(Object.keys(i).sort()).toEqual(['category', 'id', 'name_ar', 'photoUrl', 'pin']);
    expect(items.find((i) => i.name_ar === 'سوك زاكور')?.category).toBe('market');
    expect(items.find((i) => i.id === 'lm_mp_hawas_bridge')?.category).toBe('bridge');
  });

  it('another city has no seed: its own approved places only', async () => {
    const h = harness();
    expect(itemsOf(await h.feed.feed({ cityId: 'kut' }))).toEqual([]);
  });

  it('an etag the phone already has answers "unchanged" only; a change makes a new etag', async () => {
    const h = harness();
    const first = await h.feed.feed({ cityId: 'aziziyah' });
    expect(first).toMatchObject({ changed: true, maxAgeS: LANDMARK_FEED_RULES.maxAgeS });
    expect(await h.feed.feed({ cityId: 'aziziyah', etag: first.etag })).toEqual({ changed: false, etag: first.etag, maxAgeS: LANDMARK_FEED_RULES.maxAgeS });
    expect((await h.feed.feed({ cityId: 'aziziyah', etag: 'old' })).changed).toBe(true);

    // A new landmark shows once the built feed runs out (or is dropped).
    await h.landmark('جامع شارع 30', STREET_30);
    expect(await h.feed.feed({ cityId: 'aziziyah', etag: first.etag })).toMatchObject({ changed: false });
    h.clock.advance(LANDMARK_FEED_RULES.serverTtlMs);
    const second = await h.feed.feed({ cityId: 'aziziyah', etag: first.etag });
    expect(second.changed).toBe(true);
    expect(second.etag).not.toBe(first.etag);
    expect(itemsOf(second).map((i) => i.name_ar)).toContain('جامع شارع 30');
  });

  it('the etag does not move with the clock when nothing changed and no photo is signed', async () => {
    const h = harness();
    const first = await h.feed.feed({ cityId: 'aziziyah' });
    h.clock.advance(3 * 86_400_000);
    expect(await h.feed.feed({ cityId: 'aziziyah', etag: first.etag })).toMatchObject({ changed: false });
  });

  it('photos: the place’s own first, else the newest approved upload signed for two days; seeds match by key', async () => {
    const h = harness();
    const own = await h.landmark('سوق العزيزية', STREET_30, { photos: [{ id: 'pp1', url: 'https://cdn.example/souq.jpg' }] });
    const bare = await h.landmark('جامع زاكور الكبير', ZAKUR);
    h.approved.set(bare.id, 'up_mosque');
    h.approved.set(own.id, 'up_ignored');
    h.approved.set('mp_jami_kabir', 'up_seed');
    h.feed.invalidate();
    const items = itemsOf(await h.feed.feed({ cityId: 'aziziyah' }));
    const photo = (id: string) => items.find((i) => i.id === id)?.photoUrl ?? null;
    expect(photo(own.id)).toBe('https://cdn.example/souq.jpg');
    expect(photo(bare.id)).toContain('/files/up_mosque?');
    expect(photo('lm_mp_jami_kabir')).toContain('/files/up_seed?');
    expect(photo('lm_garage_bab1')).toBeNull();
    const exp = Number(new URL(photo(bare.id)!, 'http://api').searchParams.get('exp'));
    expect(exp - h.clock.now().getTime()).toBeGreaterThanOrEqual(LANDMARK_FEED_RULES.photoValidMs);
  });

  it('with a signed photo the etag changes daily, so phones never keep a dead link', async () => {
    const h = harness();
    const bare = await h.landmark('جامع زاكور الكبير', ZAKUR);
    h.approved.set(bare.id, 'up_mosque');
    h.feed.invalidate();
    const first = await h.feed.feed({ cityId: 'aziziyah' });
    h.clock.advance(86_400_000);
    expect((await h.feed.feed({ cityId: 'aziziyah', etag: first.etag })).changed).toBe(true);
  });

  it('a newly approved photo needs the feed dropped (ops does it on approval)', async () => {
    const h = harness();
    const bare = await h.landmark('جامع زاكور الكبير', ZAKUR);
    const first = await h.feed.feed({ cityId: 'aziziyah' });
    h.approved.set(bare.id, 'up_mosque');
    expect((await h.feed.feed({ cityId: 'aziziyah', etag: first.etag })).changed).toBe(false);
    h.feed.invalidate('aziziyah');
    expect((await h.feed.feed({ cityId: 'aziziyah', etag: first.etag })).changed).toBe(true);
  });
});

describe('landmarkFeedEtag / feedPhotoOf', () => {
  const view = { id: 'pl_1', name_ar: 'جامع', name_en: 'جامع', pin: STREET_30, zoneId: 'street_30', kind: 'landmark' as const, category: 'mosque' as const, aliases_ar: [], photoUrl: null };
  const now = new Date('2026-10-07T09:00:00Z');

  it('hashes what the map draws, not the zone or aliases', () => {
    const a = landmarkFeedEtag([{ view, photo: null }], now);
    expect(landmarkFeedEtag([{ view: { ...view, zoneId: 'centre', aliases_ar: ['x'] }, photo: null }], now)).toBe(a);
    expect(landmarkFeedEtag([{ view: { ...view, category: 'school' }, photo: null }], now)).not.toBe(a);
    expect(landmarkFeedEtag([{ view: { ...view, pin: { lat: STREET_30.lat + 0.0001, lng: STREET_30.lng } }, photo: null }], now)).not.toBe(a);
    expect(landmarkFeedEtag([{ view, photo: { uploadId: 'u1' } }], now)).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(64);
  });

  it('no photo when the place has none and none is approved', () => {
    expect(feedPhotoOf(view, new Map())).toBeNull();
    expect(feedPhotoOf(view, new Map([['pl_1', 'u1']]))).toEqual({ uploadId: 'u1' });
    expect(feedPhotoOf({ ...view, photoUrl: 'https://x/y.jpg' }, new Map([['pl_1', 'u1']]))).toEqual({ url: 'https://x/y.jpg' });
  });
});

describe('seedDemoLandmarks', () => {
  it('adds the demo landmarks once, approved and with their categories, around the centre, شارع 30 and زاكور', async () => {
    const h = harness();
    await h.landmark('سوق العزيزية', STREET_30);
    const added = await seedDemoLandmarks(h.places);
    expect(added).toBe(DEMO_LANDMARKS.length - 1);
    expect(await seedDemoLandmarks(h.places)).toBe(0);
    const items = itemsOf(await h.feed.feed({ cityId: 'aziziyah' }));
    for (const l of DEMO_LANDMARKS) expect(items.find((i) => i.name_ar === l.name)?.category, l.name).toBe(l.category);
    expect(new Set(DEMO_LANDMARKS.map((l) => l.zone))).toEqual(new Set(['centre', 'street_30', 'zakur']));
  });
});
