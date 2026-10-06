import { describe, expect, it } from 'vitest';
import { MainPhotoView, type Actor, type RoleKind } from '@driver/contracts';
import { createInMemoryEvents } from '../events/index.js';
import { harness as identityHarness } from '../identity/test-harness.js';
import type { OrdersService } from '../orders/index.js';
import { DevBlobStore, type BlobStore } from '../places/index.js';
import type { TripsService } from '../trips/index.js';
import { InMemoryDriverAccountRepository } from './driver-account.repository.js';
import { DriverAccountService, mainPhotoState } from './driver-account.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

async function stored(blobs: BlobStore, ownerId: string): Promise<string> {
  const ticket = await blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });
  const url = new URL(ticket.uploadUrl, 'http://local');
  await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
  return ticket.uploadId;
}

function setup() {
  const id = identityHarness('2026-10-06T09:00:00Z');
  const ev = createInMemoryEvents({ clock: id.clock });
  const blobs = new DevBlobStore(id.clock, { secret: 'main-photo-test' });
  const repo = new InMemoryDriverAccountRepository();
  const none = {} as never;
  const service = new DriverAccountService(repo, none, ev.events, {} as TripsService, {} as OrdersService, id.service, blobs, ev.uow, id.clock, 'handover-test-secret');
  async function person(phone: string, roles: RoleKind[] = []): Promise<Actor> {
    const { actor } = await id.login(phone);
    for (const kind of roles) await id.service.grantRole({ personId: 'admin' }, { personId: actor.personId, kind });
    return actor;
  }
  return { id, blobs, service, person, upload: (ownerId: string) => stored(blobs, ownerId) };
}

/** What a customer's card carries: identity's courier card (logged) → the approved ref only. */
async function customerSees(h: ReturnType<typeof setup>, driverId: string, customerId: string): Promise<string | null> {
  return (await h.id.service.courierCard(driverId, customerId)).photoRef;
}

describe('mainPhotoState (Ali, 2026-10-06)', () => {
  it('none → pending → approved | rejected, from his latest photo document', () => {
    expect(mainPhotoState(null)).toBe('none');
    expect(mainPhotoState({ status: 'pending' })).toBe('pending');
    expect(mainPhotoState({ status: 'approved' })).toBe('approved');
    expect(mainPhotoState({ status: 'rejected' })).toBe('rejected');
  });
});

describe('driverAccount main photo', () => {
  it('only an approved photo reaches customers; a new one waits for review while the old one stays', async () => {
    const h = setup();
    const driver = await h.person('07700000301', ['courier']);
    const ops = await h.person('07700000302', ['field_ops']);
    const customer = await h.person('07700000303');
    expect(await h.service.mainPhoto(driver)).toEqual({ state: 'none', approved: null, latest: null });

    // Sent: «تنتظر الموافقة»; customers still see his initial.
    const first = await h.upload(driver.personId);
    const sent = MainPhotoView.parse(await h.service.setMainPhoto(driver, { uploadId: first }));
    expect(sent).toMatchObject({ state: 'pending', approved: null, latest: { status: 'pending', url: expect.stringContaining(`/files/${first}?`) } });
    expect(await customerSees(h, driver.personId, customer.personId)).toBeNull();

    // Approved: «مقبولة»; customers see it.
    await h.service.reviewDocument(ops, { documentId: sent.latest!.documentId, decision: 'approve' });
    const ok = await h.service.mainPhoto(driver);
    expect(ok).toMatchObject({ state: 'approved', approved: { url: expect.stringContaining(`/files/${first}?`), approvedAt: h.id.clock.now() } });
    expect(await customerSees(h, driver.personId, customer.personId)).toBe(first);

    // A new photo: pending again, the approved one stays what customers see.
    const second = await h.upload(driver.personId);
    const again = await h.service.setMainPhoto(driver, { uploadId: second });
    expect(again).toMatchObject({ state: 'pending', approved: { url: expect.stringContaining(first) }, latest: { url: expect.stringContaining(second) } });
    expect(await customerSees(h, driver.personId, customer.personId)).toBe(first);

    // Rejected: «مرفوضة: {reason}»; still the old one for customers.
    await h.service.reviewDocument(ops, { documentId: again.latest!.documentId, decision: 'reject', reason: 'الوجه مو واضح' });
    expect(await h.service.mainPhoto(driver)).toMatchObject({ state: 'rejected', approved: { url: expect.stringContaining(first) }, latest: { status: 'rejected', rejectReason: 'الوجه مو واضح' } });
    expect(await customerSees(h, driver.personId, customer.personId)).toBe(first);

    // A third, approved: it replaces the first everywhere.
    const third = await h.upload(driver.personId);
    const next = await h.service.setMainPhoto(driver, { uploadId: third });
    await h.service.reviewDocument(ops, { documentId: next.latest!.documentId, decision: 'approve' });
    expect(await customerSees(h, driver.personId, customer.personId)).toBe(third);
    expect((await h.service.mainPhoto(driver)).approved?.url).toContain(third);
  });

  it("refuses someone else's upload, and a reviewer never approves his own photo", async () => {
    const h = setup();
    const driver = await h.person('07700000311', ['courier', 'field_ops']);
    const other = await h.person('07700000312', ['courier']);
    await expect(h.service.setMainPhoto(driver, { uploadId: await h.upload(other.personId) })).rejects.toMatchObject({ code: 'upload_invalid' });
    const mine = await h.service.setMainPhoto(driver, { uploadId: await h.upload(driver.personId) });
    await expect(h.service.reviewDocument(driver, { documentId: mine.latest!.documentId, decision: 'approve' })).rejects.toMatchObject({ code: 'forbidden' });
    expect(await customerSees(h, driver.personId, other.personId)).toBeNull();
  });

  it('customer reads of the photo are logged in the vault (main_photo), batched reads leave out drivers without one', async () => {
    const h = setup();
    const a = await h.person('07700000321', ['driver']);
    const b = await h.person('07700000322', ['driver']);
    const ops = await h.person('07700000323', ['field_ops']);
    const rider = await h.person('07700000324');
    const sent = await h.service.setMainPhoto(a, { uploadId: await h.upload(a.personId) });
    await h.service.reviewDocument(ops, { documentId: sent.latest!.documentId, decision: 'approve' });
    const refs = await h.id.service.mainPhotoRefs([a.personId, b.personId], rider.personId, 'intercity_driver_card');
    expect(Object.keys(refs)).toEqual([a.personId]);
    const logs = h.id.repo.accessLogs.filter((l) => l.accessorId === rider.personId);
    expect(logs).toEqual([expect.objectContaining({ personId: a.personId, purpose: 'intercity_driver_card', fieldsRead: ['main_photo'] })]);
    await h.id.service.courierCard(a.personId, rider.personId);
    expect(h.id.repo.accessLogs.at(-1)).toMatchObject({ purpose: 'courier_card', fieldsRead: ['name', 'main_photo'] });
  });
});
