import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../shared/clock.js';
import { DevObjectStorage, objectStorageFromEnv, S3ObjectStorage, s3ConfigFromEnv, type ObjectStoragePort } from './object-storage.js';
import { InMemoryUploadRecords, ObjectBlobStore } from './uploads.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00]);
const AT = new Date('2026-10-04T12:00:00Z');
const CFG = { endpoint: 'https://fake-storage.test', bucket: 'driver-photos', accessKeyId: 'AKIDTEST', secretAccessKey: 'secret-test-key', region: 'auto' };

/** SigV4 query-string signature computed independently of the SDK (AWS "Authenticating requests: query parameters"). */
function expectedSignature(method: string, url: URL, headers: Record<string, string>, secret: string): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const params = [...url.searchParams.entries()].filter(([k]) => k !== 'X-Amz-Signature').map(([k, v]) => [enc(k), enc(v)] as const);
  params.sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  const signed = url.searchParams.get('X-Amz-SignedHeaders')!.split(';');
  const all: Record<string, string> = { host: url.host, ...headers };
  const canonical = [
    method,
    url.pathname.split('/').map((s) => enc(decodeURIComponent(s))).join('/'),
    params.map(([k, v]) => `${k}=${v}`).join('&'),
    signed.map((h) => `${h}:${all[h]!.trim()}\n`).join(''),
    signed.join(';'),
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const amzDate = url.searchParams.get('X-Amz-Date')!;
  const [, date, region, service] = /^[^/]+\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request$/.exec(url.searchParams.get('X-Amz-Credential')!)!;
  const scope = `${date}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, date!), region!), service!), 'aws4_request');
  return createHmac('sha256', key).update(toSign).digest('hex');
}

describe('S3ObjectStorage signing (fake endpoint, no network)', () => {
  const storage = new S3ObjectStorage(CFG, { now: () => AT });

  it('presigned GET: path-style URL on the endpoint, 5-minute expiry, a valid SigV4 signature', async () => {
    const url = new URL(await storage.presignGet({ key: 'up_abc', expiresInSec: 300 }));
    expect(url.origin).toBe('https://fake-storage.test');
    expect(url.pathname).toBe('/driver-photos/up_abc');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Credential')).toBe('AKIDTEST/20261004/auto/s3/aws4_request');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261004T120000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(expectedSignature('GET', url, {}, CFG.secretAccessKey));
    // Deterministic for a fixed signing time; a different secret signs differently.
    expect(await storage.presignGet({ key: 'up_abc', expiresInSec: 300 })).toBe(url.toString());
    expect(expectedSignature('GET', url, {}, 'other')).not.toBe(url.searchParams.get('X-Amz-Signature'));
  });

  it('presigned PUT signs the content type, so the bucket refuses another one', async () => {
    const put = await storage.presignPut({ key: 'up_abc', contentType: 'image/jpeg', expiresInSec: 900 });
    expect(put.headers).toEqual({ 'content-type': 'image/jpeg' });
    const url = new URL(put.url);
    expect(url.pathname).toBe('/driver-photos/up_abc');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('content-type;host');
    expect(url.searchParams.get('X-Amz-Signature')).toBe(expectedSignature('PUT', url, { 'content-type': 'image/jpeg' }, CFG.secretAccessKey));
    expect(url.searchParams.get('X-Amz-Signature')).not.toBe(expectedSignature('PUT', url, { 'content-type': 'image/png' }, CFG.secretAccessKey));
  });

  it('head / ranged read / delete go to the endpoint as signed requests; 404 reads as missing', async () => {
    const seen: Array<{ method: string; path: string; range: string | undefined; auth: boolean }> = [];
    const respond = (statusCode: number, headers: Record<string, string>, body: Buffer = Buffer.alloc(0)) => ({ response: { statusCode, headers, body: Readable.from(body.length ? [body] : []) } });
    const fake = new S3ObjectStorage(CFG, {
      now: () => AT,
      clientConfig: {
        maxAttempts: 1,
        requestHandler: {
          handle: async (req: { method: string; path: string; headers: Record<string, string> }) => {
            seen.push({ method: req.method, path: req.path, range: req.headers['range'], auth: (req.headers['authorization'] ?? '').startsWith('AWS4-HMAC-SHA256 Credential=AKIDTEST/') });
            if (req.path.endsWith('/up_missing')) return respond(404, { 'content-type': 'application/xml' }, Buffer.from('<Error><Code>NoSuchKey</Code></Error>'));
            if (req.method === 'HEAD') return respond(200, { 'content-length': '14', 'content-type': 'image/jpeg' });
            if (req.method === 'GET') return respond(206, { 'content-length': '12', 'content-type': 'image/jpeg' }, JPEG.subarray(0, 12));
            return respond(204, {});
          },
        } as never,
      },
    });
    expect(await fake.head('up_abc')).toEqual({ sizeBytes: 14, contentType: 'image/jpeg' });
    expect((await fake.readStart('up_abc', 12))?.equals(JPEG.subarray(0, 12))).toBe(true);
    expect(await fake.head('up_missing')).toBeNull();
    expect(await fake.get('up_missing')).toBeNull();
    await fake.delete('up_abc');
    expect(seen.map((s) => [s.method, s.path, s.range])).toEqual([
      ['HEAD', '/driver-photos/up_abc', undefined],
      ['GET', '/driver-photos/up_abc', 'bytes=0-11'],
      ['HEAD', '/driver-photos/up_missing', undefined],
      ['GET', '/driver-photos/up_missing', undefined],
      ['DELETE', '/driver-photos/up_abc', undefined],
    ]);
    expect(seen.every((s) => s.auth)).toBe(true);
  });
});

describe('storage selection by env', () => {
  it('S3 only when all four S3_* variables are set; path-style and region `auto` by default', () => {
    const env = { S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' };
    expect(s3ConfigFromEnv(env)).toEqual({ ...{ endpoint: env.S3_ENDPOINT, bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' }, region: 'auto', forcePathStyle: true });
    expect(s3ConfigFromEnv({ ...env, S3_REGION: 'eu-central-1', S3_FORCE_PATH_STYLE: 'false' })).toMatchObject({ region: 'eu-central-1', forcePathStyle: false });
    expect(s3ConfigFromEnv({ ...env, S3_SECRET_ACCESS_KEY: '' })).toBeNull();
    expect(objectStorageFromEnv(env)).toBeInstanceOf(S3ObjectStorage);
    expect(objectStorageFromEnv({})).toBeInstanceOf(DevObjectStorage);
  });
});

/** A direct (bucket-like) storage in memory: what the client PUT lands here. */
class FakeBucket implements ObjectStoragePort {
  readonly direct = true;
  readonly objects = new Map<string, Buffer>();
  async presignPut(input: { key: string; contentType: string; expiresInSec: number }) {
    return { url: `https://bucket.test/${input.key}?put&ttl=${input.expiresInSec}`, headers: { 'content-type': input.contentType } };
  }
  async presignGet(input: { key: string; expiresInSec: number }) {
    return `https://bucket.test/${input.key}?get&ttl=${input.expiresInSec}`;
  }
  async put(key: string, bytes: Buffer) {
    this.objects.set(key, bytes);
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async head(key: string) {
    const b = this.objects.get(key);
    return b ? { sizeBytes: b.length, contentType: null } : null;
  }
  async readStart(key: string, n: number) {
    return this.objects.get(key)?.subarray(0, n) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

describe('ObjectBlobStore over direct object storage', () => {
  function setup() {
    const clock = new FakeClock(AT);
    const bucket = new FakeBucket();
    const store = new ObjectBlobStore(clock, new InMemoryUploadRecords(), bucket, { secret: 's' });
    return { clock, bucket, store };
  }

  it('the ticket is a presigned PUT on the bucket; the first get checks size and magic bytes, then it is stored', async () => {
    const { bucket, store } = setup();
    const t = await store.createUpload({ ownerId: 'ali', contentType: 'image/jpeg', sizeBytes: JPEG.length });
    expect(t).toMatchObject({ uploadUrl: `https://bucket.test/${t.uploadId}?put&ttl=900`, method: 'PUT', headers: { 'content-type': 'image/jpeg' } });
    expect((await store.get(t.uploadId))?.state).toBe('pending'); // nothing uploaded yet
    bucket.objects.set(t.uploadId, JPEG);
    expect(await store.get(t.uploadId)).toMatchObject({ state: 'stored', sizeBytes: JPEG.length, ownerId: 'ali' });
    const read = new URL(store.readUrl(t.uploadId), 'http://api');
    const signed = { id: t.uploadId, exp: read.searchParams.get('exp') ?? undefined, sig: read.searchParams.get('sig') ?? undefined };
    expect(await store.readLocation(signed)).toBe(`https://bucket.test/${t.uploadId}?get&ttl=300`);
    expect(await store.readLocation({ ...signed, sig: 'forged' })).toBeNull();
    await store.remove(t.uploadId);
    expect(bucket.objects.has(t.uploadId)).toBe(false);
    expect(await store.get(t.uploadId)).toBeNull();
  });

  it('a renamed file or one over the declared size is deleted from the bucket and never stored', async () => {
    const { bucket, store } = setup();
    const fake = await store.createUpload({ ownerId: 'ali', contentType: 'image/jpeg', sizeBytes: 100 });
    bucket.objects.set(fake.uploadId, Buffer.from('GIF89a, not a jpeg'));
    expect((await store.get(fake.uploadId))?.state).toBe('pending');
    expect(bucket.objects.has(fake.uploadId)).toBe(false);
    const big = await store.createUpload({ ownerId: 'ali', contentType: 'image/jpeg', sizeBytes: 4 });
    bucket.objects.set(big.uploadId, JPEG);
    expect((await store.get(big.uploadId))?.state).toBe('pending');
    expect(bucket.objects.has(big.uploadId)).toBe(false);
  });
});
