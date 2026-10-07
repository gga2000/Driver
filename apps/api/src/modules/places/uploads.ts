import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DriverError, PHOTO_MAX_BYTES, UPLOAD_RULES, VOICE_RULES, VoiceContentType, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';
import type { PrismaService } from '../../shared/db/prisma.service.js';
import { InMemoryWindowCounter, type WindowCounter } from '../../shared/window-counter.js';
import { DevObjectStorage, type ObjectStoragePort } from './object-storage.js';

/**
 * Photo and voice-note storage behind a signed-URL interface (domain §7 gate photos, menu / shop photos,
 * documents, evidence; chat voice notes, ride ideas n7/n8). The app asks for a ticket, PUTs the bytes to the ticket's URL, then references the upload id
 * when it saves the place. Reads go through short-lived signed URLs: home photos are personal data
 * (domain §13) and are never public.
 *
 * `ObjectBlobStore` keeps the record (owner, declared type and size, state) in an `UploadRecords` store
 * (`uploads` table with DATABASE_URL) and the bytes behind `ObjectStoragePort`: with S3-compatible storage
 * the client PUTs straight to the bucket (presigned) and the first `get` checks the object; with the dev
 * storage the API's `UploadsController` receives and serves the bytes (docs/persistence.md).
 */
/** What an upload may hold: a photo, or a voice note (each kind has its own size cap and magic bytes). */
export type UploadContentType = PhotoContentType | VoiceContentType;

export interface BlobRecord {
  id: string;
  ownerId: string;
  contentType: UploadContentType;
  maxBytes: number;
  sizeBytes: number | null;
  state: 'pending' | 'stored';
  createdAt: Date;
  expiresAt: Date;
}

export interface BlobStore {
  createUpload(input: { ownerId: string; contentType: UploadContentType; sizeBytes: number }): Promise<PhotoUploadTicket>;
  /** Transport side of the API PUT: checks the signature, size, type and magic bytes. */
  receive(input: { id: string; exp: string | undefined; sig: string | undefined; contentType: string | undefined; bytes: Buffer }): Promise<BlobRecord>;
  /**
   * A photo upload's record; a pending direct upload is checked against the bucket first (and stored or
   * refused). Voice notes are not photos: their ids read as null here, so no module can attach one as a
   * photo.
   */
  get(id: string): Promise<BlobRecord | null>;
  /** A voice note's record (`chat.voiceUpload`), checked like `get`; null for photos. */
  getVoice(id: string): Promise<BlobRecord | null>;
  /**
   * Signed read URL on the API, stable within the hour so clients can cache it. `validForMs`: still
   * valid that long from now (a feed phones keep for hours, maps program b3); default about an hour.
   */
  readUrl(id: string, validForMs?: number): string;
  read(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<{ contentType: string; bytes: Buffer } | null>;
  /** For a valid signed read: a short-lived presigned URL of the storage itself (direct storage only), else null. */
  readLocation(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<string | null>;
  remove(id: string): Promise<void>;
  /**
   * SEC-24: deletes up to `limit` tickets never uploaded (still pending `UPLOAD_RULES.keepUnfinishedHours`
   * after they were issued), with any bytes a direct upload left in the bucket; returns how many went.
   */
  purgeUnfinished(limit: number): Promise<number>;
}

export const BLOB_STORE = Symbol('BLOB_STORE');

/**
 * The upload is this person's and its bytes arrived: what a module asks before it attaches a photo
 * id the app sent, so nobody can attach someone else's upload (or one that never finished).
 */
export async function ownsStoredUpload(blobs: Pick<BlobStore, 'get'>, uploadId: string, personId: string): Promise<boolean> {
  const rec = await blobs.get(uploadId);
  return rec !== null && rec.ownerId === personId && rec.state === 'stored';
}

/** A voice note's type (`audio/*`), as opposed to a photo's. */
export function isVoiceType(contentType: string): contentType is VoiceContentType {
  return VoiceContentType.safeParse(contentType).success;
}

/** The size cap of an upload of this type. */
export function maxBytesFor(contentType: UploadContentType): number {
  return isVoiceType(contentType) ? VOICE_RULES.maxBytes : PHOTO_MAX_BYTES;
}
const UPLOAD_TTL_MS = 15 * 60_000;
const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
const DIRECT_READ_TTL_SEC = 300;
const MAGIC_BYTES = 12;

/** Magic bytes per accepted type: a renamed file is refused. */
export function sniffImage(bytes: Buffer): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Magic bytes of a voice note: an MP4 / M4A box (`ftyp` at byte 4, what iOS, Android and Safari
 * record), an ADTS AAC frame (12-bit sync word, layer 0), WebM (EBML header, Chrome) or Ogg (Firefox).
 */
export function sniffAudio(bytes: Buffer): VoiceContentType | null {
  if (bytes.length >= 8 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return 'audio/webm';
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xf6) === 0xf0) return 'audio/aac';
  return null;
}

/** The type the first bytes say, photo or voice note. */
export function sniffUpload(bytes: Buffer): UploadContentType | null {
  return sniffImage(bytes) ?? sniffAudio(bytes);
}

// ───────────────────────── records ─────────────────────────

/** The `uploads` table (or memory). Bytes are never here. */
export interface UploadRecords {
  insert(rec: BlobRecord): Promise<void>;
  get(id: string): Promise<BlobRecord | null>;
  /** pending → stored; false when it was not pending any more. */
  markStored(id: string, sizeBytes: number): Promise<boolean>;
  delete(id: string): Promise<void>;
  /** The person's tickets still waiting for their bytes (pending and not expired at `now`). */
  openTickets(ownerId: string, now: Date): Promise<number>;
  /** Ids of pending tickets issued before `before`, oldest first. */
  unfinishedBefore(before: Date, limit: number): Promise<string[]>;
}

export class InMemoryUploadRecords implements UploadRecords {
  private readonly rows = new Map<string, BlobRecord>();

  async insert(rec: BlobRecord): Promise<void> {
    this.rows.set(rec.id, { ...rec });
  }

  async get(id: string): Promise<BlobRecord | null> {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async markStored(id: string, sizeBytes: number): Promise<boolean> {
    const r = this.rows.get(id);
    if (!r || r.state !== 'pending') return false;
    r.state = 'stored';
    r.sizeBytes = sizeBytes;
    return true;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async openTickets(ownerId: string, now: Date): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) if (r.ownerId === ownerId && r.state === 'pending' && r.expiresAt > now) n += 1;
    return n;
  }

  async unfinishedBefore(before: Date, limit: number): Promise<string[]> {
    return [...this.rows.values()]
      .filter((r) => r.state === 'pending' && r.createdAt < before)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((r) => r.id);
  }
}

export class PrismaUploadRecords implements UploadRecords {
  constructor(private readonly prisma: PrismaService) {}

  async insert(rec: BlobRecord): Promise<void> {
    await this.prisma.prisma.upload.create({
      data: { id: rec.id, ownerId: rec.ownerId, contentType: rec.contentType, maxBytes: rec.maxBytes, sizeBytes: rec.sizeBytes, state: rec.state, storageKey: rec.id, expiresAt: rec.expiresAt, createdAt: rec.createdAt },
    });
  }

  async get(id: string): Promise<BlobRecord | null> {
    const r = await this.prisma.prisma.upload.findUnique({ where: { id } });
    return r
      ? { id: r.id, ownerId: r.ownerId, contentType: r.contentType as UploadContentType, maxBytes: r.maxBytes, sizeBytes: r.sizeBytes, state: r.state === 'stored' ? 'stored' : 'pending', createdAt: r.createdAt, expiresAt: r.expiresAt }
      : null;
  }

  async markStored(id: string, sizeBytes: number): Promise<boolean> {
    const { count } = await this.prisma.prisma.upload.updateMany({ where: { id, state: 'pending' }, data: { state: 'stored', sizeBytes } });
    return count === 1;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.prisma.upload.deleteMany({ where: { id } });
  }

  openTickets(ownerId: string, now: Date): Promise<number> {
    return this.prisma.prisma.upload.count({ where: { ownerId, state: 'pending', expiresAt: { gt: now } } });
  }

  async unfinishedBefore(before: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.prisma.upload.findMany({ where: { state: 'pending', createdAt: { lt: before } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
    return rows.map((r) => r.id);
  }
}

// ───────────────────────── store ─────────────────────────

export interface BlobStoreOptions {
  /** Signs the API's upload / read URLs (UPLOADS_SECRET, else JWT_SECRET; random per process otherwise). */
  secret?: string | undefined;
  /** Makes ticket and read URLs absolute (UPLOADS_PUBLIC_ORIGIN). */
  publicOrigin?: string | undefined;
  /** Counts each person's tickets per day across API instances (Redis); in process otherwise. */
  counter?: WindowCounter | undefined;
}

export class ObjectBlobStore implements BlobStore {
  private readonly secret: string;
  private readonly origin: string;

  constructor(
    private readonly clock: Clock,
    private readonly records: UploadRecords,
    readonly storage: ObjectStoragePort,
    opts: BlobStoreOptions = {},
  ) {
    this.secret = opts.secret ?? randomBytes(32).toString('hex');
    this.origin = (opts.publicOrigin ?? '').replace(/\/$/, '');
    this.tickets = opts.counter ?? new InMemoryWindowCounter(clock);
  }

  /** SEC-24: tickets issued per person in the last 24 hours. */
  private readonly tickets: WindowCounter;

  private sign(op: 'put' | 'get', id: string, exp: number): string {
    return createHmac('sha256', this.secret).update(`${op}:${id}:${exp}`).digest('base64url');
  }

  private verify(op: 'put' | 'get', id: string, exp: string | undefined, sig: string | undefined): boolean {
    const e = Number(exp);
    if (!sig || !Number.isFinite(e) || e < this.clock.now().getTime()) return false;
    const want = Buffer.from(this.sign(op, id, e));
    const got = Buffer.from(sig);
    return want.length === got.length && timingSafeEqual(want, got);
  }

  async createUpload(input: { ownerId: string; contentType: UploadContentType; sizeBytes: number }): Promise<PhotoUploadTicket> {
    if (input.sizeBytes > maxBytesFor(input.contentType)) throw new DriverError('upload_invalid');
    const now = this.clock.now();
    // SEC-24: a few tickets open at once (a retry loop that never uploads stops here), and a daily cap.
    if ((await this.records.openTickets(input.ownerId, now)) >= UPLOAD_RULES.pendingPerPerson) {
      throw new DriverError('rate_limited', { retryAfterSec: UPLOAD_TTL_MS / 1000 });
    }
    const day = await this.tickets.hit(`upload:ticket:${input.ownerId}`, DAY_MS, UPLOAD_RULES.perPersonPerDay);
    if (!day.allowed) throw new DriverError('rate_limited', { retryAfterSec: day.retryAfterSec });
    const id = `up_${randomUUID().replaceAll('-', '')}`;
    const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
    await this.records.insert({ id, ownerId: input.ownerId, contentType: input.contentType, maxBytes: input.sizeBytes, sizeBytes: null, state: 'pending', createdAt: now, expiresAt });
    const exp = expiresAt.getTime();
    const target = this.storage.direct
      ? await this.storage.presignPut({ key: id, contentType: input.contentType, expiresInSec: UPLOAD_TTL_MS / 1000 })
      : { url: `${this.origin}/uploads/${id}?exp=${exp}&sig=${this.sign('put', id, exp)}`, headers: { 'content-type': input.contentType } };
    return { uploadId: id, uploadUrl: target.url, method: 'PUT', headers: target.headers, expiresAt, maxBytes: input.sizeBytes };
  }

  async receive(input: { id: string; exp: string | undefined; sig: string | undefined; contentType: string | undefined; bytes: Buffer }): Promise<BlobRecord> {
    const rec = await this.records.get(input.id);
    if (!rec || rec.state !== 'pending' || !this.verify('put', input.id, input.exp, input.sig)) throw new DriverError('upload_invalid');
    const type = (input.contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== rec.contentType || input.bytes.length === 0 || input.bytes.length > rec.maxBytes || sniffUpload(input.bytes) !== rec.contentType) throw new DriverError('upload_invalid');
    await this.storage.put(rec.id, input.bytes, rec.contentType);
    if (!(await this.records.markStored(rec.id, input.bytes.length))) throw new DriverError('upload_invalid');
    return { ...rec, state: 'stored', sizeBytes: input.bytes.length };
  }

  async get(id: string): Promise<BlobRecord | null> {
    const rec = await this.lookup(id);
    return rec && !isVoiceType(rec.contentType) ? rec : null;
  }

  async getVoice(id: string): Promise<BlobRecord | null> {
    const rec = await this.lookup(id);
    return rec && isVoiceType(rec.contentType) ? rec : null;
  }

  private async lookup(id: string): Promise<BlobRecord | null> {
    const rec = await this.records.get(id);
    if (!rec || rec.state === 'stored' || !this.storage.direct) return rec;
    return this.checkDirectUpload(rec);
  }

  /**
   * A direct upload never passed through the API: the bucket enforced the signed content type; size
   * and magic bytes are checked here. A bad object is deleted and the record stays pending.
   */
  private async checkDirectUpload(rec: BlobRecord): Promise<BlobRecord> {
    const head = await this.storage.head(rec.id);
    if (!head) return rec;
    const start = head.sizeBytes > 0 && head.sizeBytes <= rec.maxBytes ? await this.storage.readStart(rec.id, MAGIC_BYTES) : null;
    if (!start || sniffUpload(start) !== rec.contentType) {
      await this.storage.delete(rec.id);
      return rec;
    }
    await this.records.markStored(rec.id, head.sizeBytes);
    return { ...rec, state: 'stored', sizeBytes: head.sizeBytes };
  }

  readUrl(id: string, validForMs = 0): string {
    const now = this.clock.now().getTime();
    const exp = Math.ceil((now + validForMs) / HOUR_MS) * HOUR_MS + HOUR_MS;
    return `${this.origin}/files/${id}?exp=${exp}&sig=${this.sign('get', id, exp)}`;
  }

  private async readable(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<BlobRecord | null> {
    if (!this.verify('get', input.id, input.exp, input.sig)) return null;
    const rec = await this.records.get(input.id);
    return rec?.state === 'stored' ? rec : null;
  }

  async read(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<{ contentType: string; bytes: Buffer } | null> {
    const rec = await this.readable(input);
    if (!rec) return null;
    const bytes = await this.storage.get(rec.id);
    return bytes ? { contentType: rec.contentType, bytes } : null;
  }

  async readLocation(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<string | null> {
    if (!this.storage.direct) return null;
    const rec = await this.readable(input);
    return rec ? this.storage.presignGet({ key: rec.id, expiresInSec: DIRECT_READ_TTL_SEC }) : null;
  }

  async remove(id: string): Promise<void> {
    await this.storage.delete(id);
    await this.records.delete(id);
  }

  async purgeUnfinished(limit: number): Promise<number> {
    const before = new Date(this.clock.now().getTime() - UPLOAD_RULES.keepUnfinishedHours * 3_600_000);
    const ids = await this.records.unfinishedBefore(before, limit);
    // The bytes first: a record without bytes is harmless, bytes without a record are never found again.
    for (const id of ids) await this.remove(id);
    return ids.length;
  }
}

/**
 * The in-memory store of tests, the simulator and the demo API: records in memory, bytes in memory
 * (and on disk under `dir`). Same behaviour as production minus persistence.
 */
export class DevBlobStore extends ObjectBlobStore {
  constructor(clock: Clock, opts: BlobStoreOptions & { dir?: string | undefined } = {}) {
    super(clock, new InMemoryUploadRecords(), new DevObjectStorage(opts.dir), opts);
  }
}
