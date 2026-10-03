import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Where photo bytes live (docs/persistence.md). Keys are opaque (the upload id); the bucket is private,
 * so every client read and write goes through a short-lived signed URL.
 */
export interface ObjectStoragePort {
  /** True when clients PUT and GET the bytes at presigned URLs of the storage itself (the API never proxies them). */
  readonly direct: boolean;
  presignPut(input: { key: string; contentType: string; expiresInSec: number }): Promise<{ url: string; headers: Record<string, string> }>;
  presignGet(input: { key: string; expiresInSec: number }): Promise<string>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  /** The first `n` bytes (magic-byte check) without downloading the whole object. */
  readStart(key: string, n: number): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/**
 * Development storage: bytes in memory, and on disk under `dir` when given (so they survive a restart).
 * Not direct: the API serves the signed `PUT /uploads/:id` and `GET /files/:id` itself.
 */
export class DevObjectStorage implements ObjectStoragePort {
  readonly direct = false;
  private readonly bytes = new Map<string, { bytes: Buffer; contentType: string }>();

  constructor(private readonly dir?: string) {
    if (dir) mkdirSync(dir, { recursive: true });
  }

  async presignPut(): Promise<{ url: string; headers: Record<string, string> }> {
    throw new Error('DevObjectStorage is not direct: uploads go through the API');
  }

  async presignGet(): Promise<string> {
    throw new Error('DevObjectStorage is not direct: reads go through the API');
  }

  private path(key: string): string | null {
    // Keys are minted by the API (`up_<hex>`); refuse anything that could leave the directory.
    if (!this.dir || !/^[A-Za-z0-9_-]+$/.test(key)) return null;
    return join(this.dir, key);
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.bytes.set(key, { bytes, contentType });
    const p = this.path(key);
    if (p) writeFileSync(p, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    const hit = this.bytes.get(key);
    if (hit) return hit.bytes;
    const p = this.path(key);
    if (!p) return null;
    try {
      return readFileSync(p);
    } catch {
      return null;
    }
  }

  async head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    const b = await this.get(key);
    return b ? { sizeBytes: b.length, contentType: this.bytes.get(key)?.contentType ?? null } : null;
  }

  async readStart(key: string, n: number): Promise<Buffer | null> {
    return (await this.get(key))?.subarray(0, n) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.bytes.delete(key);
    const p = this.path(key);
    if (p) rmSync(p, { force: true });
  }
}

export interface S3StorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** R2 uses `auto`; Supabase Storage its project region. */
  region?: string;
  /** Path-style URLs (`<endpoint>/<bucket>/<key>`): Supabase Storage and MinIO need it, R2 accepts it. */
  forcePathStyle?: boolean;
}

const notFound = (err: unknown): boolean => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

/**
 * S3-compatible object storage (Supabase Storage, Cloudflare R2, MinIO) on a private bucket. Clients
 * upload with a presigned PUT whose `content-type` is signed (a different type is refused by the
 * storage) and read with presigned GETs. `now` fixes the signing time in tests.
 */
export class S3ObjectStorage implements ObjectStoragePort {
  readonly direct = true;
  private readonly client: S3Client;
  private readonly now: () => Date;

  constructor(
    private readonly cfg: S3StorageConfig,
    opts: { now?: () => Date; clientConfig?: Partial<S3ClientConfig> } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region ?? 'auto',
      forcePathStyle: cfg.forcePathStyle ?? true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Supabase Storage and older R2 setups reject the newer default CRC32 checksum headers.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      ...opts.clientConfig,
    });
  }

  async presignPut(input: { key: string; contentType: string; expiresInSec: number }): Promise<{ url: string; headers: Record<string, string> }> {
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.cfg.bucket, Key: input.key, ContentType: input.contentType }), {
      expiresIn: input.expiresInSec,
      signableHeaders: new Set(['content-type']),
      signingDate: this.now(),
    });
    return { url, headers: { 'content-type': input.contentType } };
  }

  presignGet(input: { key: string; expiresInSec: number }): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: input.key }), { expiresIn: input.expiresInSec, signingDate: this.now() });
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.length }));
  }

  private async getRange(key: string, range?: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ...(range ? { Range: range } : {}) }));
      return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : Buffer.alloc(0);
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  get(key: string): Promise<Buffer | null> {
    return this.getRange(key);
  }

  async head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { sizeBytes: Number(out.ContentLength ?? 0), contentType: out.ContentType ?? null };
    } catch (err) {
      if (notFound(err)) return null;
      throw err;
    }
  }

  readStart(key: string, n: number): Promise<Buffer | null> {
    return this.getRange(key, `bytes=0-${Math.max(0, n - 1)}`);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}

/** S3 settings from the environment, or null when any of the four required variables is missing. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3StorageConfig | null {
  const endpoint = env['S3_ENDPOINT'];
  const bucket = env['S3_BUCKET'];
  const accessKeyId = env['S3_ACCESS_KEY_ID'];
  const secretAccessKey = env['S3_SECRET_ACCESS_KEY'];
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: env['S3_REGION'] || 'auto',
    forcePathStyle: env['S3_FORCE_PATH_STYLE'] ? env['S3_FORCE_PATH_STYLE'] !== 'false' : true,
  };
}

/** S3-compatible storage when configured, else the dev store (disk under UPLOADS_DIR when set). */
export function objectStorageFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStoragePort {
  const s3 = s3ConfigFromEnv(env);
  return s3 ? new S3ObjectStorage(s3) : new DevObjectStorage(env['UPLOADS_DIR'] || undefined);
}
