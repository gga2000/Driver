import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

/** A photo's file name: lower-case words, a number, `.webp`. Nothing else is ever looked up. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.webp$/;

/** The folder with the stock food photos (`apps/api/media/food`), found from src or dist alike. */
function mediaDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'media', 'food');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return null;
}

const DIR = mediaDir();

/** The file to send for a requested name, or null (bad name, unknown photo, no folder). */
export function foodMediaPath(name: string): string | null {
  if (!DIR || !NAME.test(name)) return null;
  const path = join(DIR, name);
  return existsSync(path) ? path : null;
}

/**
 * `GET /media/food/:name`: the stock food photos the customer app shows on /food and the door pages
 * until a kitchen uploads its own (Ali's dish library). They live here instead of inside the app so the
 * download is about 1.2 MB smaller and a picture can change without an app update. A name never changes
 * its picture (a new picture gets a new name), so phones keep each one for a year. The `lib-*` files are
 * the Merchant app's «من صورنا» library (a kitchen picks one and it is uploaded as its own photo), served
 * from here for the same reason (about 4.9 MB off the merchant download).
 */
@Controller()
export class FoodMediaController {
  @Get('media/food/:name')
  get(@Param('name') name: string, @Res() res: Response): void {
    const path = foodMediaPath(name);
    if (!path) {
      res.status(404).end();
      return;
    }
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.setHeader('cross-origin-resource-policy', 'cross-origin');
    res.type('image/webp');
    // Relative to the folder: `send` refuses any absolute path with a dot folder in it (a checkout under
    // `.claude/worktrees/…`), while the name itself is already checked above.
    res.sendFile(basename(path), { root: dirname(path) }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  }
}
