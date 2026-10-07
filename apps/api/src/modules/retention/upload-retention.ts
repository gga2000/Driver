import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { BLOB_STORE, type BlobStore } from '../places/index.js';

/** How often unfinished uploads are swept. */
export const UNFINISHED_UPLOAD_PURGE_EVERY_MS = 15 * 60_000;
/** Tickets per round: each is a storage delete plus a row delete. */
export const UNFINISHED_UPLOAD_PURGE_BATCH = 500;

/**
 * SEC-24: a photo or voice-note ticket that never got its bytes (the app was closed, the upload failed)
 * is deleted a day after it was issued, with anything a direct upload left in the bucket, so the
 * `uploads` table and the bucket only hold what was really uploaded. Runs in every API instance; a
 * ticket already deleted is simply not found again.
 */
@Injectable()
export class UploadRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UploadRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(@Inject(BLOB_STORE) private readonly blobs: BlobStore) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.safeTick(), UNFINISHED_UPLOAD_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes the unfinished uploads past their day; returns how many went. */
  async tick(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.blobs.purgeUnfinished(UNFINISHED_UPLOAD_PURGE_BATCH);
      total += n;
      if (n < UNFINISHED_UPLOAD_PURGE_BATCH) return total;
    }
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`upload retention: deleted ${n} uploads that never arrived`);
    } catch (err) {
      this.logger.error(`upload retention failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
