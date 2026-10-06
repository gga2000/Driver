import { describe, expect, it } from 'vitest';
import { KhatRunTrip } from '@driver/contracts';
import type { DispatchService } from '../dispatch/index.js';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import { PINS, tripsHarness } from '../trips/test-harness.js';
import { InMemoryKhatRepository } from './khat.repository.js';
import { DEFAULT_KHAT_CONFIG, KhatService, type KhatPhotosPort } from './khat.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

async function stored(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

/** A خطوط run with one child (زينب), her guardian, the run's driver and another khat driver. */
async function setup() {
  const t = tripsHarness('2026-10-04T04:00:00Z');
  const id = identityHarness('2026-10-04T04:00:00Z');
  const ev = createInMemoryEvents({ clock: t.clock });
  const blobs = new DevBlobStore(t.clock, { secret: 'child-photo-test' });
  const guardian = (await id.login('07700000100')).actor;
  const stranger = (await id.login('07700000101')).actor;
  const driver = (await id.login('07700000200')).actor;
  const other = (await id.login('07700000201')).actor;
  const zainab = (await id.service.registerChild(guardian, { name: 'زينب علي حسين' })).childRef;
  const w = (min: number) => new Date(t.clock.now().getTime() + min * 60_000);
  const trip = await t.trips.createForOrders({
    cityId: 'aziziyah',
    vertical: 'khat',
    orders: [],
    stops: [
      { type: 'pickup', zoneKey: 'zakur', target: PINS.home, childRef: zainab, windowStart: w(10), windowEnd: w(15) },
      { type: 'dropoff', zoneKey: 'centre', target: PINS.school, childRef: zainab, windowStart: w(30), windowEnd: w(35) },
    ],
  });
  await t.trips.offer(trip.id, { driverIds: [driver.personId] });
  await t.trips.accept(trip.id, driver.personId, { vehicleClass: 'van' });
  const removed: string[] = [];
  const photos: KhatPhotosPort = {
    owns: async (uploadId, personId) => {
      const rec = await blobs.get(uploadId);
      return rec !== null && rec.ownerId === personId && rec.state === 'stored';
    },
    readUrl: (ref) => blobs.readUrl(ref),
    remove: async (ref) => {
      removed.push(ref);
      await blobs.remove(ref);
    },
  };
  const khat = new KhatService(new InMemoryKhatRepository(), t.trips, id.service, {} as DispatchService, ev.events, t.uow, t.clock, null, null, DEFAULT_KHAT_CONFIG, photos);
  return { t, id, blobs, khat, guardian, stranger, driver, other, zainab, trip, removed };
}

const childOf = (run: KhatRunTrip) => run.stops[0]!.child!;

describe('خطوط child photos (Ali, 2026-10-06)', () => {
  it('the guardian adds a photo; only the run driver sees it, each read logged with child_photo', async () => {
    const h = await setup();
    expect((await h.khat.guardianChildren(h.guardian))[0]).toMatchObject({ childRef: h.zainab, name: 'زينب علي حسين', photoUrl: null });
    const upload = await stored(h.blobs, h.guardian.personId);
    const child = await h.khat.setChildPhoto(h.guardian, { childRef: h.zainab, uploadId: upload });
    expect(child.photoUrl).toContain(`/files/${upload}?exp=`);

    const run = (await h.khat.todayRun(h.driver, {})).trips[0]!;
    expect(KhatRunTrip.parse(run).stops[0]!.child).toMatchObject({ firstName: 'زينب', photoUrl: expect.stringContaining(`/files/${upload}?`) });
    const log = h.id.repo.accessLogs.filter((l) => l.accessorId === h.driver.personId && l.purpose === 'khat_today_run');
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((l) => l.personId === h.guardian.personId && l.childRef === h.zainab && l.fieldsRead.includes('child_photo'))).toBe(true);
  });

  it('a driver who does not drive the run never gets the child or the photo', async () => {
    const h = await setup();
    await h.khat.setChildPhoto(h.guardian, { childRef: h.zainab, uploadId: await stored(h.blobs, h.guardian.personId) });
    expect((await h.khat.todayRun(h.other, {})).trips).toEqual([]);
    await expect(h.khat.tapIn(h.other, { tripId: h.trip.id, stopId: h.trip.stops[0]!.id })).rejects.toMatchObject({ code: 'forbidden' });
    expect(h.id.repo.accessLogs.some((l) => l.accessorId === h.other.personId)).toBe(false);
  });

  it("only the child's guardian sets or removes it, and only with his own stored upload", async () => {
    const h = await setup();
    const strangers = await stored(h.blobs, h.stranger.personId);
    await expect(h.khat.setChildPhoto(h.stranger, { childRef: h.zainab, uploadId: strangers })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.khat.setChildPhoto(h.guardian, { childRef: h.zainab, uploadId: strangers })).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(h.khat.removeChildPhoto(h.stranger, { childRef: h.zainab })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(h.khat.setChildPhoto(h.guardian, { childRef: 'chref_nope', uploadId: await stored(h.blobs, h.guardian.personId) })).rejects.toMatchObject({ code: 'not_found' });
    expect(await h.khat.guardianChildren(h.stranger)).toEqual([]);
  });

  it('removal works: the vault forgets it, the bytes are deleted, the driver sees the initial again', async () => {
    const h = await setup();
    const first = await stored(h.blobs, h.guardian.personId);
    await h.khat.setChildPhoto(h.guardian, { childRef: h.zainab, uploadId: first });
    // Replacing deletes the first photo's bytes.
    const second = await stored(h.blobs, h.guardian.personId);
    await h.khat.setChildPhoto(h.guardian, { childRef: h.zainab, uploadId: second });
    expect(h.removed).toEqual([first]);
    expect(await h.blobs.get(first)).toBeNull();

    const after = await h.khat.removeChildPhoto(h.guardian, { childRef: h.zainab });
    expect(after.photoUrl).toBeNull();
    expect(h.removed).toEqual([first, second]);
    expect(await h.blobs.get(second)).toBeNull();
    expect(childOf((await h.khat.todayRun(h.driver, {})).trips[0]!).photoUrl).toBeNull();
    expect(h.id.events.types()).toEqual(expect.arrayContaining(['child.photo_set', 'child.photo_removed']));
  });
});
