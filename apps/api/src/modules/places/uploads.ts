import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DriverError, PHOTO_MAX_BYTES, type PhotoContentType, type PhotoUploadTicket } from '@driver/contracts';
import type { Clock } from '../../shared/clock.js';

/**
 * Photo storage behind a signed-URL interface (domain §7 gate photos). The app asks for a ticket,
 * PUTs the bytes to the ticket's URL, then references the upload id when it saves the place. Reads go
 * through short-lived signed URLs: home photos are personal data (domain §13) and are never public.
 *
 * `DevBlobStore` keeps bytes in memory (and on disk under UPLOADS_DIR when set) and is served by
 * `UploadsController`. Production swaps in an object-storage implementation (R2 / Supabase Storage
 * presigned PUT + GET on a private bucket) behind the same interface.
 */
export interface BlobRecord {
  id: string;
  ownerId: string;
  contentType: PhotoContentType;
  maxBytes: number;
  sizeBytes: number | null;
  state: 'pending' | 'stored';
  createdAt: Date;
  expiresAt: Date;
}

export interface BlobStore {
  createUpload(input: { ownerId: string; contentType: PhotoContentType; sizeBytes: number }): Promise<PhotoUploadTicket>;
  /** Transport side of the PUT: checks the signature, size, type and magic bytes. */
  receive(input: { id: string; exp: string | undefined; sig: string | undefined; contentType: string | undefined; bytes: Buffer }): Promise<BlobRecord>;
  get(id: string): Promise<BlobRecord | null>;
  /** Signed read URL, stable within the hour so clients can cache it. */
  readUrl(id: string): string;
  read(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<{ contentType: string; bytes: Buffer } | null>;
  remove(id: string): Promise<void>;
}

export const BLOB_STORE = Symbol('BLOB_STORE');
const UPLOAD_TTL_MS = 15 * 60_000;
const HOUR_MS = 3_600_000;

/** Magic bytes per accepted type: a renamed file is refused. */
export function sniffImage(bytes: Buffer): PhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export class DevBlobStore implements BlobStore {
  private readonly records = new Map<string, BlobRecord>();
  private readonly bytes = new Map<string, Buffer>();
  private readonly secret: string;
  private readonly origin: string;
  private readonly dir: string | undefined;

  constructor(
    private readonly clock: Clock,
    opts: { secret?: string | undefined; publicOrigin?: string | undefined; dir?: string | undefined } = {},
  ) {
    this.secret = opts.secret ?? randomBytes(32).toString('hex');
    this.origin = (opts.publicOrigin ?? '').replace(/\/$/, '');
    this.dir = opts.dir;
    if (this.dir) mkdirSync(this.dir, { recursive: true });
  }

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

  async createUpload(input: { ownerId: string; contentType: PhotoContentType; sizeBytes: number }): Promise<PhotoUploadTicket> {
    if (input.sizeBytes > PHOTO_MAX_BYTES) throw new DriverError('upload_invalid');
    const now = this.clock.now();
    const id = `up_${randomUUID().replaceAll('-', '')}`;
    const expiresAt = new Date(now.getTime() + UPLOAD_TTL_MS);
    this.records.set(id, { id, ownerId: input.ownerId, contentType: input.contentType, maxBytes: input.sizeBytes, sizeBytes: null, state: 'pending', createdAt: now, expiresAt });
    const exp = expiresAt.getTime();
    return {
      uploadId: id,
      uploadUrl: `${this.origin}/uploads/${id}?exp=${exp}&sig=${this.sign('put', id, exp)}`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      expiresAt,
      maxBytes: input.sizeBytes,
    };
  }

  async receive(input: { id: string; exp: string | undefined; sig: string | undefined; contentType: string | undefined; bytes: Buffer }): Promise<BlobRecord> {
    const rec = this.records.get(input.id);
    if (!rec || rec.state !== 'pending' || !this.verify('put', input.id, input.exp, input.sig)) throw new DriverError('upload_invalid');
    const type = (input.contentType ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== rec.contentType || input.bytes.length === 0 || input.bytes.length > rec.maxBytes || sniffImage(input.bytes) !== rec.contentType) throw new DriverError('upload_invalid');
    this.bytes.set(rec.id, input.bytes);
    if (this.dir) writeFileSync(join(this.dir, rec.id), input.bytes);
    rec.state = 'stored';
    rec.sizeBytes = input.bytes.length;
    return { ...rec };
  }

  async get(id: string): Promise<BlobRecord | null> {
    const rec = this.records.get(id);
    return rec ? { ...rec } : null;
  }

  readUrl(id: string): string {
    const now = this.clock.now().getTime();
    const exp = Math.ceil(now / HOUR_MS) * HOUR_MS + HOUR_MS;
    return `${this.origin}/files/${id}?exp=${exp}&sig=${this.sign('get', id, exp)}`;
  }

  async read(input: { id: string; exp: string | undefined; sig: string | undefined }): Promise<{ contentType: string; bytes: Buffer } | null> {
    const rec = this.records.get(input.id);
    if (!rec || rec.state !== 'stored' || !this.verify('get', input.id, input.exp, input.sig)) return null;
    const bytes = this.bytes.get(rec.id) ?? (this.dir ? readFileSync(join(this.dir, rec.id)) : undefined);
    return bytes ? { contentType: rec.contentType, bytes } : null;
  }

  async remove(id: string): Promise<void> {
    this.records.delete(id);
    this.bytes.delete(id);
  }
}
