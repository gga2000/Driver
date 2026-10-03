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
 * The API side of photo storage: `PUT /uploads/:id?exp&sig` (the signed ticket from
 * `places.photoUpload`, dev storage only — with object storage the ticket points at the bucket) and
 * `GET /files/:id?exp&sig` (signed, expiring read: the bytes from the dev storage, or a 302 to a
 * presigned GET on the bucket). The tRPC surface is the same either way.
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
    res.end(file.bytes);
  }
}
