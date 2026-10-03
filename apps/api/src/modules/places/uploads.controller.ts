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
 * The dev storage's HTTP side: `PUT /uploads/:id?exp&sig` (the signed ticket from
 * `places.photoUpload`) and `GET /files/:id?exp&sig` (signed, expiring read). Object storage
 * replaces both in production; the tRPC surface stays the same.
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
    const file = await this.store.read({ id: String(req.params['id']), exp: q(req.query['exp']), sig: q(req.query['sig']) });
    if (!file) {
      res.status(404).end();
      return;
    }
    res.setHeader('content-type', file.contentType);
    res.setHeader('cache-control', 'private, max-age=3600');
    res.end(file.bytes);
  }
}
