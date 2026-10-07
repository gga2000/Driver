import { Controller, Get, Inject, Put, Req, Res } from '@nestjs/common';
import { errorEnvelope, isDriverError, PHOTO_MAX_BYTES } from '@driver/contracts';
import type { Request, Response } from 'express';
import { BLOB_STORE, type BlobStore } from './uploads.js';

/** Reads a raw request body up to `max` bytes (null when larger). */
function readBody(req: Request, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > max) over = true;
      else chunks.push(c);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const q = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/**
 * One `Range: bytes=a-b` (or `a-`, or `-n`) over a file of `size` bytes: what audio players ask for
 * (iOS refuses to play a voice note from a server that ignores ranges). Null: serve the whole file;
 * 'unsatisfiable': a range outside the file.
 */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'unsatisfiable' : { start, end };
}

/**
 * The API side of photo and voice-note storage: `PUT /uploads/:id?exp&sig` (the signed ticket from
 * `places.photoUpload`, dev storage only — with object storage the ticket points at the bucket) and
 * `GET /files/:id?exp&sig` (signed, expiring read: the bytes from the dev storage, with byte
 * ranges for audio players, or a 302 to a presigned GET on the bucket). The tRPC surface is the same either way.
 */
@Controller()
export class UploadsController {
  constructor(@Inject(BLOB_STORE) private readonly store: BlobStore) {}

  @Put('uploads/:id')
  async put(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const bytes = await readBody(req, PHOTO_MAX_BYTES);
      if (!bytes) {
        res.status(413).json(errorEnvelope('upload_invalid'));
        return;
      }
      const rec = await this.store.receive({ id: String(req.params['id']), exp: q(req.query['exp']), sig: q(req.query['sig']), contentType: req.headers['content-type'], bytes });
      res.status(200).json({ uploadId: rec.id, sizeBytes: rec.sizeBytes });
    } catch (err) {
      res.status(400).json(errorEnvelope(isDriverError(err) ? err.code : 'upload_invalid'));
    }
  }

  @Get('files/:id')
  async get(@Req() req: Request, @Res() res: Response): Promise<void> {
    const signed = { id: String(req.params['id']), exp: q(req.query['exp']), sig: q(req.query['sig']) };
    // Object storage: the API checks its own signature, then hands over a 5-minute presigned GET.
    const location = await this.store.readLocation(signed);
    if (location) {
      res.setHeader('cache-control', 'private, max-age=240');
      res.redirect(302, location);
      return;
    }
    const file = await this.store.read(signed);
    if (!file) {
      res.status(404).end();
      return;
    }
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.setHeader('accept-ranges', 'bytes');
    const size = file.bytes.length;
    const range = byteRange(q(req.headers['range']), size);
    if (range === 'unsatisfiable') {
      res.setHeader('content-range', `bytes */${size}`);
      res.status(416).end();
      return;
    }
    if (range) {
      res.status(206);
      res.setHeader('content-range', `bytes ${range.start}-${range.end}/${size}`);
      res.end(file.bytes.subarray(range.start, range.end + 1));
      return;
    }
    res.end(file.bytes);
  }
}
