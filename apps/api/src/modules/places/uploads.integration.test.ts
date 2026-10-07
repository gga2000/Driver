import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { UPLOAD_RULES } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { PrismaService } from '../../shared/db/prisma.service.js';
import { DevObjectStorage } from './object-storage.js';
import { ObjectBlobStore, PrismaUploadRecords } from './uploads.js';

/**
 * The `uploads` table's quota and sweep queries on a real Postgres (SEC-24): open tickets per person,
 * and tickets never uploaded deleted a day later while finished ones stay. Skipped without DATABASE_URL.
 */
const url = process.env['DATABASE_URL'];
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

describe.skipIf(!url)('upload quota and sweep on Postgres (needs DATABASE_URL)', () => {
  const prisma = new PrismaService(url);
  const owner = `p_up_${randomUUID().slice(0, 8)}`;
  // Far in the past, so the sweep (rows issued before this clock minus a day) never reaches other rows of a shared database.
  const clock = new FakeClock('2001-01-01T09:00:00Z');
  const blobs = new ObjectBlobStore(clock, new PrismaUploadRecords(prisma), new DevObjectStorage(), { secret: 'test' });

  afterAll(async () => {
    await prisma.prisma.upload.deleteMany({ where: { ownerId: owner } });
    await prisma.onModuleDestroy();
  });

  it('counts open tickets, then deletes only the ones never uploaded', async () => {
    const done = await blobs.createUpload({ ownerId: owner, contentType: 'image/jpeg', sizeBytes: JPEG.length });
    const url1 = new URL(done.uploadUrl, 'http://x');
    await blobs.receive({ id: done.uploadId, exp: url1.searchParams.get('exp') ?? undefined, sig: url1.searchParams.get('sig') ?? undefined, contentType: 'image/jpeg', bytes: JPEG });
    const open: string[] = [];
    for (let i = 1; i < UPLOAD_RULES.pendingPerPerson + 1; i += 1) open.push((await blobs.createUpload({ ownerId: owner, contentType: 'image/jpeg', sizeBytes: 100 })).uploadId);
    await expect(blobs.createUpload({ ownerId: owner, contentType: 'image/jpeg', sizeBytes: 100 })).rejects.toMatchObject({ code: 'rate_limited' });

    clock.advance(UPLOAD_RULES.keepUnfinishedHours * 3_600_000 + 1);
    expect(await blobs.purgeUnfinished(4)).toBe(4);
    expect(await blobs.purgeUnfinished(100)).toBe(open.length - 4);
    expect(await prisma.prisma.upload.findMany({ where: { ownerId: owner }, select: { id: true, state: true } })).toEqual([{ id: done.uploadId, state: 'stored' }]);
  });
});
