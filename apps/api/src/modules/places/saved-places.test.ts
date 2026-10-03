import { describe, expect, it } from 'vitest';
import { DriverError, type LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { createInMemoryEvents } from '../events/index.js';
import { courierMaySeePlaceDetails, InMemorySavedPlacesRepository, SavedPlacesService } from './saved-places.service.js';
import { DevBlobStore, sniffImage } from './uploads.js';
import { ZoneResolver } from './zones.js';

const STREET_30: LatLng = { lat: 32.9095, lng: 45.0635 };
const ZAKUR: LatLng = { lat: 32.887, lng: 45.0765 };
const BAGHDAD: LatLng = { lat: 33.3152, lng: 44.3661 };
/** ~22 m north of STREET_30. */
const NEAR_STREET_30: LatLng = { lat: 32.9097, lng: 45.0635 };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

function harness() {
  const clock = new FakeClock('2026-10-03T09:00:00Z');
  const { events, repo: eventsRepo } = createInMemoryEvents({ clock });
  const blobs = new DevBlobStore(clock, { secret: 'test-secret' });
  const households = new Map<string, string[]>();
  const service = new SavedPlacesService(new InMemorySavedPlacesRepository(), blobs, { peersOf: (id) => households.get(id) ?? [] }, events, clock);
  const recorded: Array<{ type: string; payload: Record<string, unknown> }> = [];
  events.subscribe('test:places', '*', async (e) => {
    recorded.push({ type: e.type, payload: e.payload as Record<string, unknown> });
  });
  const base = { cityId: 'aziziyah', photoIds: [] as string[], shareWithHousehold: false };
  /** A finished upload owned by `ownerId`. */
  async function photo(ownerId: string) {
    const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const u = new URL(ticket.uploadUrl, 'http://api');
    await blobs.receive({ id: ticket.uploadId, exp: u.searchParams.get('exp') ?? undefined, sig: u.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
    return ticket.uploadId;
  }
  return { clock, events, eventsRepo, blobs, households, service, recorded, base, photo };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (err) {
    return err instanceof DriverError ? err.code : String(err);
  }
};

describe('zone resolution (server side, from the pin)', () => {
  it('nearest seed centroid within the service area; null far away', () => {
    const z = new ZoneResolver();
    expect(z.resolve('aziziyah', STREET_30)).toBe('street_30');
    expect(z.resolve('aziziyah', ZAKUR)).toBe('zakur');
    expect(z.resolve('aziziyah', BAGHDAD)).toBeNull();
    expect(z.resolve('nowhere', STREET_30)).toBeNull();
    expect(z.names('aziziyah', 'street_30')).toEqual({ ar: 'شارع 30', en: 'Street 30' });
  });

  it('verified polygons win over centroids', () => {
    const z = new ZoneResolver();
    z.register('aziziyah', [{ zoneId: 'centre', ring: [{ lat: 32.909, lng: 45.063 }, { lat: 32.91, lng: 45.063 }, { lat: 32.91, lng: 45.064 }, { lat: 32.909, lng: 45.064 }] }]);
    expect(z.resolve('aziziyah', STREET_30)).toBe('centre');
  });

  it('save resolves the zone (a client zone is never trusted); out of area is refused', async () => {
    const h = harness();
    const p = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: ZAKUR });
    expect(p).toMatchObject({ zoneId: 'zakur', zoneName_ar: 'زاكور', confirmed: false, access: 'owner' });
    expect(await code(h.service.save('ali', { ...h.base, label: 'custom', name: 'بغداد', pin: BAGHDAD }))).toBe('outside_zone');
    expect(h.service.zoneFor('aziziyah', BAGHDAD)).toEqual({ zoneId: null, zoneName_ar: null, zoneName_en: null, inService: false });
    expect(h.service.zoneFor('aziziyah', STREET_30)).toMatchObject({ zoneId: 'street_30', inService: true });
  });
});

describe('owner checks and visibility (domain §7)', () => {
  it('only the owner lists, edits, confirms or removes a place; others get place_not_found', async () => {
    const h = harness();
    const p = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: STREET_30, note: 'باب أخضر' });
    expect((await h.service.mine('ali')).map((x) => x.id)).toEqual([p.id]);
    expect(await h.service.mine('stranger')).toEqual([]);
    expect(await code(h.service.update('stranger', { placeId: p.id, name: 'لي' }))).toBe('place_not_found');
    expect(await code(h.service.remove('stranger', p.id))).toBe('place_not_found');
    expect(await code(h.service.confirm('stranger', { placeId: p.id, pin: STREET_30 }))).toBe('place_not_found');
    expect(await code(h.service.update('ali', { placeId: 'nope', name: 'x' }))).toBe('place_not_found');
    expect((await h.service.update('ali', { placeId: p.id, note: null })).note).toBeNull();
    expect(await h.service.remove('ali', p.id)).toEqual({ ok: true });
    expect(await h.service.mine('ali')).toEqual([]);
  });

  it('household members see places shared with the household, read-only; unshared stay private', async () => {
    const h = harness();
    h.households.set('ali', ['minar']).set('minar', ['ali']);
    const shared = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: STREET_30, shareWithHousehold: true });
    const priv = await h.service.save('ali', { ...h.base, label: 'work', name: 'المستشفى', pin: ZAKUR });
    const seen = await h.service.mine('minar');
    expect(seen.map((x) => [x.id, x.access])).toEqual([[shared.id, 'household']]);
    expect(seen.some((x) => x.id === priv.id)).toBe(false);
    expect(await code(h.service.update('minar', { placeId: shared.id, name: 'بيتي' }))).toBe('place_not_found');
    expect((await h.service.mine('stranger')).length).toBe(0);
    await h.service.update('ali', { placeId: shared.id, shareWithHousehold: false });
    expect(await h.service.mine('minar')).toEqual([]);
    await h.service.settled();
    expect(h.recorded.filter((e) => e.type === 'place.shared')).toHaveLength(1);
  });

  it('couriers: only the assigned one, from accepted to completed + 1 h', () => {
    const acceptedAt = new Date('2026-10-03T10:00:00Z');
    const completedAt = new Date('2026-10-03T10:30:00Z');
    const trip = { courierId: 'k1', acceptedAt, completedAt };
    const at = (iso: string) => new Date(iso);
    expect(courierMaySeePlaceDetails({ courierId: 'k1', trip, now: at('2026-10-03T10:10:00Z') })).toBe(true);
    expect(courierMaySeePlaceDetails({ courierId: 'k1', trip, now: at('2026-10-03T11:30:00Z') })).toBe(true);
    expect(courierMaySeePlaceDetails({ courierId: 'k1', trip, now: at('2026-10-03T11:30:01Z') })).toBe(false);
    expect(courierMaySeePlaceDetails({ courierId: 'k2', trip, now: at('2026-10-03T10:10:00Z') })).toBe(false);
    expect(courierMaySeePlaceDetails({ courierId: 'k1', trip: { ...trip, acceptedAt: null }, now: at('2026-10-03T10:10:00Z') })).toBe(false);
    expect(courierMaySeePlaceDetails({ courierId: 'k1', trip: { ...trip, completedAt: null }, now: at('2026-10-04T10:10:00Z') })).toBe(true);
    expect(courierMaySeePlaceDetails({ courierId: 'k1', trip: { ...trip, cancelled: true }, now: at('2026-10-03T10:10:00Z') })).toBe(false);
  });

  it('events carry ids and zone, never the note, name or photos', async () => {
    const h = harness();
    await h.service.save('ali', { ...h.base, label: 'home', name: 'بيت علي', pin: STREET_30, note: 'باب أخضر يم الجامع' });
    await h.service.settled();
    const saved = h.recorded.find((e) => e.type === 'place.saved')!;
    expect(saved.payload).toMatchObject({ ownerId: 'ali', zoneId: 'street_30', label: 'home' });
    expect(JSON.stringify(h.recorded)).not.toMatch(/باب أخضر|بيت علي/);
  });
});

describe('labels, idempotency and confirmation', () => {
  it('one home per person: a second home demotes the first to custom', async () => {
    const h = harness();
    const a = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت القديم', pin: STREET_30 });
    const b = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: ZAKUR });
    const mine = await h.service.mine('ali');
    expect(mine.map((x) => [x.id, x.label])).toEqual([
      [b.id, 'home'],
      [a.id, 'custom'],
    ]);
  });

  it('clientRef makes the device-place migration idempotent', async () => {
    const h = harness();
    const a = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: STREET_30, clientRef: 'device:place_1' });
    const b = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: STREET_30, clientRef: 'device:place_1' });
    expect(b.id).toBe(a.id);
    expect(await h.service.mine('ali')).toHaveLength(1);
  });

  it('"موقعي هنا": a fix within 40 m confirms; farther moves the pin and re-resolves the zone; a weak fix is refused', async () => {
    const h = harness();
    const p = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: STREET_30 });
    expect(p.confirmed).toBe(false);
    const agreed = await h.service.confirm('ali', { placeId: p.id, pin: NEAR_STREET_30, accuracyM: 12 });
    expect(agreed).toMatchObject({ confirmed: true, confidence: 0.85, pin: STREET_30, zoneId: 'street_30' });
    expect(agreed.confirmedAt?.toISOString()).toBe('2026-10-03T09:00:00.000Z');
    const moved = await h.service.confirm('ali', { placeId: p.id, pin: ZAKUR });
    expect(moved).toMatchObject({ confirmed: true, confidence: 0.8, pin: ZAKUR, zoneId: 'zakur' });
    expect(await code(h.service.confirm('ali', { placeId: p.id, pin: ZAKUR, accuracyM: 150 }))).toBe('location_weak');
    expect(await code(h.service.confirm('ali', { placeId: p.id, pin: BAGHDAD }))).toBe('outside_zone');
    // Moving the pin by hand far away drops the confirmation.
    const edited = await h.service.update('ali', { placeId: p.id, pin: STREET_30 });
    expect(edited).toMatchObject({ confirmed: false, confirmedAt: null, zoneId: 'street_30' });
  });
});

describe('gate photos: signed uploads', () => {
  it('a finished upload of the owner attaches; someone else’s, a pending or an unknown one is refused', async () => {
    const h = harness();
    const mine = await h.photo('ali');
    const theirs = await h.photo('stranger');
    const pending = (await h.blobs.createUpload({ ownerId: 'ali', contentType: 'image/jpeg', sizeBytes: 100 })).uploadId;
    const p = await h.service.save('ali', { ...h.base, label: 'home', name: 'البيت', pin: STREET_30, photoIds: [mine] });
    expect(p.photos.map((x) => x.id)).toEqual([mine]);
    expect(p.photos[0]!.url).toMatch(new RegExp(`^/files/${mine}\\?exp=\\d+&sig=`));
    for (const bad of [theirs, pending, 'up_nope']) expect(await code(h.service.save('ali', { ...h.base, label: 'custom', name: 'x', pin: STREET_30, photoIds: [bad] }))).toBe('upload_invalid');
    // Replacing photos drops the old blob.
    const next = await h.photo('ali');
    const updated = await h.service.update('ali', { placeId: p.id, photoIds: [next] });
    expect(updated.photos.map((x) => x.id)).toEqual([next]);
    expect(await h.blobs.get(mine)).toBeNull();
  });

  it('PUT needs a valid signature, the declared type, real image bytes and the size limit; reads need a signed, unexpired URL', async () => {
    const h = harness();
    const t = await h.blobs.createUpload({ ownerId: 'ali', contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const u = new URL(t.uploadUrl, 'http://api');
    const exp = u.searchParams.get('exp') ?? undefined;
    const sig = u.searchParams.get('sig') ?? undefined;
    const put = (over: Partial<{ exp: string; sig: string; contentType: string; bytes: Buffer }>) => code(h.blobs.receive({ id: t.uploadId, exp, sig, contentType: 'image/jpeg', bytes: JPEG, ...over }));
    expect(await put({ sig: 'forged' })).toBe('upload_invalid');
    expect(await put({ contentType: 'image/png' })).toBe('upload_invalid');
    expect(await put({ bytes: Buffer.from('not an image at all') })).toBe('upload_invalid');
    expect(await put({ bytes: Buffer.concat([JPEG, JPEG]) })).toBe('upload_invalid');
    expect(await put({})).toBe('ok');
    expect(await put({})).toBe('upload_invalid'); // single use
    const read = new URL(h.blobs.readUrl(t.uploadId), 'http://api');
    const r = (s?: string) => h.blobs.read({ id: t.uploadId, exp: read.searchParams.get('exp') ?? undefined, sig: s ?? read.searchParams.get('sig') ?? undefined });
    expect((await r())?.bytes.equals(JPEG)).toBe(true);
    expect(await r('forged')).toBeNull();
    h.clock.advance(3 * 3_600_000);
    expect(await r()).toBeNull();
  });

  it('upload tickets expire after 15 minutes', async () => {
    const h = harness();
    const t = await h.blobs.createUpload({ ownerId: 'ali', contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const u = new URL(t.uploadUrl, 'http://api');
    h.clock.advance(16 * 60_000);
    expect(await code(h.blobs.receive({ id: t.uploadId, exp: u.searchParams.get('exp') ?? undefined, sig: u.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG }))).toBe('upload_invalid');
  });

  it('sniffs jpeg, png and webp', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toBe('image/webp');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
  });
});
