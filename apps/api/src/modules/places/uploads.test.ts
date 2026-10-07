import { describe, expect, it } from 'vitest';
import { PHOTO_MAX_BYTES, UPLOAD_RULES, VOICE_RULES } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { byteRange } from './uploads.controller.js';
import { DevBlobStore, ownsStoredUpload, sniffAudio, sniffUpload } from './uploads.js';

const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypM4A ', 'latin1'), Buffer.alloc(64)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64)]);
const OGG = Buffer.concat([Buffer.from('OggS', 'latin1'), Buffer.alloc(64)]);
const ADTS = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(64)]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

function store() {
  const clock = new FakeClock('2026-10-07T09:00:00Z');
  const blobs = new DevBlobStore(clock, { secret: 'test' });
  /** Ticket then the PUT, as the app does it. */
  async function put(ownerId: string, contentType: Parameters<DevBlobStore['createUpload']>[0]['contentType'], bytes: Buffer, sent = contentType) {
    const ticket = await blobs.createUpload({ ownerId, contentType, sizeBytes: bytes.length });
    const url = new URL(ticket.uploadUrl, 'http://x');
    await blobs.receive({ id: ticket.uploadId, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined, contentType: sent, bytes });
    return ticket.uploadId;
  }
  return { blobs, put, clock };
}

describe('voice-note uploads', () => {
  it('sniffs m4a, webm, ogg and ADTS AAC; a JPEG is no voice note', () => {
    expect(sniffAudio(M4A)).toBe('audio/mp4');
    expect(sniffAudio(WEBM)).toBe('audio/webm');
    expect(sniffAudio(OGG)).toBe('audio/ogg');
    expect(sniffAudio(ADTS)).toBe('audio/aac');
    expect(sniffAudio(JPEG)).toBeNull();
    expect(sniffAudio(Buffer.from('ID3'))).toBeNull();
    expect(sniffUpload(JPEG)).toBe('image/jpeg');
    expect(sniffUpload(OGG)).toBe('audio/ogg');
  });

  it('stores a recording whose bytes match the declared type; a renamed file is refused', async () => {
    const { blobs, put } = store();
    const id = await put('c1', 'audio/webm', WEBM, 'audio/webm');
    expect(await blobs.getVoice(id)).toMatchObject({ ownerId: 'c1', state: 'stored', contentType: 'audio/webm' });
    await expect(put('c1', 'audio/mp4', WEBM)).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(put('c1', 'audio/ogg', JPEG)).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(put('c1', 'image/jpeg', M4A)).rejects.toMatchObject({ code: 'upload_invalid' });
  });

  it('caps a voice note at 1 MB and a photo at 5 MB', async () => {
    const { blobs } = store();
    await expect(blobs.createUpload({ ownerId: 'c1', contentType: 'audio/mp4', sizeBytes: VOICE_RULES.maxBytes + 1 })).rejects.toMatchObject({ code: 'upload_invalid' });
    await expect(blobs.createUpload({ ownerId: 'c1', contentType: 'audio/mp4', sizeBytes: VOICE_RULES.maxBytes })).resolves.toMatchObject({ maxBytes: VOICE_RULES.maxBytes });
    await expect(blobs.createUpload({ ownerId: 'c1', contentType: 'image/jpeg', sizeBytes: PHOTO_MAX_BYTES })).resolves.toMatchObject({ maxBytes: PHOTO_MAX_BYTES });
  });

  it('a voice note never reads as a photo (no module can attach one as a photo), nor a photo as a voice note', async () => {
    const { blobs, put } = store();
    const voice = await put('c1', 'audio/mp4', M4A);
    const photo = await put('c1', 'image/jpeg', JPEG);
    expect(await blobs.get(voice)).toBeNull();
    expect(await ownsStoredUpload(blobs, voice, 'c1')).toBe(false);
    expect(await blobs.getVoice(photo)).toBeNull();
    expect(await ownsStoredUpload(blobs, photo, 'c1')).toBe(true);
    // Removal deletes the record and the bytes.
    const url = new URL(blobs.readUrl(voice), 'http://x');
    const signed = { id: voice, exp: url.searchParams.get('exp') ?? undefined, sig: url.searchParams.get('sig') ?? undefined };
    expect((await blobs.read(signed))?.contentType).toBe('audio/mp4');
    await blobs.remove(voice);
    expect(await blobs.read(signed)).toBeNull();
  });
});

describe('byteRange (audio players ask for ranges)', () => {
  it('reads a-b, a- and -n; clamps the end to the file', () => {
    expect(byteRange('bytes=0-1', 100)).toEqual({ start: 0, end: 1 });
    expect(byteRange('bytes=10-', 100)).toEqual({ start: 10, end: 99 });
    expect(byteRange('bytes=-20', 100)).toEqual({ start: 80, end: 99 });
    expect(byteRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 });
  });

  it('serves the whole file without (or with a malformed) Range, and refuses one outside the file', () => {
    expect(byteRange(undefined, 100)).toBeNull();
    expect(byteRange('bytes=-', 100)).toBeNull();
    expect(byteRange('items=0-1', 100)).toBeNull();
    expect(byteRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(byteRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(byteRange('bytes=5-2', 100)).toBe('unsatisfiable');
    expect(byteRange('bytes=-0', 100)).toBe('unsatisfiable');
  });
});

describe('upload quota and unfinished tickets (SEC-24)', () => {
  const ticket = (blobs: DevBlobStore, ownerId: string) => blobs.createUpload({ ownerId, contentType: 'image/jpeg', sizeBytes: JPEG.length });

  it('a few tickets may wait for their bytes at once; finishing or expiring one frees a place', async () => {
    const { blobs, put, clock } = store();
    for (let i = 0; i < UPLOAD_RULES.pendingPerPerson; i += 1) await ticket(blobs, 'c1');
    await expect(ticket(blobs, 'c1')).rejects.toMatchObject({ code: 'rate_limited' });
    // Someone else is not affected.
    await expect(ticket(blobs, 'c2')).resolves.toMatchObject({ maxBytes: JPEG.length });
    // The open tickets expire after 15 minutes; uploads that arrive never count as open.
    clock.advance(15 * 60_000 + 1);
    await put('c1', 'image/jpeg', JPEG);
    await expect(ticket(blobs, 'c1')).resolves.toBeTruthy();
  });

  it('at most the daily number of tickets per person in any 24 hours', async () => {
    const { blobs, put, clock } = store();
    for (let i = 0; i < UPLOAD_RULES.perPersonPerDay; i += 1) {
      await put('c1', 'image/jpeg', JPEG);
      clock.advance(60_000);
    }
    const refused = await ticket(blobs, 'c1').catch((err: unknown) => err);
    expect(refused).toMatchObject({ code: 'rate_limited' });
    expect((refused as { envelope: { retryAfterSec?: number } }).envelope.retryAfterSec).toBeGreaterThan(0);
    clock.advance(24 * 3_600_000 - UPLOAD_RULES.perPersonPerDay * 60_000 + 60_000);
    await expect(ticket(blobs, 'c1')).resolves.toBeTruthy();
  });

  it('a ticket never uploaded is deleted a day later; uploaded files stay', async () => {
    const { blobs, put, clock } = store();
    const kept = await put('c1', 'image/jpeg', JPEG);
    const lost = (await ticket(blobs, 'c1')).uploadId;
    clock.advance(UPLOAD_RULES.keepUnfinishedHours * 3_600_000 - 1);
    expect(await blobs.purgeUnfinished(100)).toBe(0);
    clock.advance(2);
    expect(await blobs.purgeUnfinished(100)).toBe(1);
    expect(await blobs.get(lost)).toBeNull();
    expect(await blobs.get(kept)).toMatchObject({ state: 'stored' });
    expect(await blobs.purgeUnfinished(100)).toBe(0);
  });
});
