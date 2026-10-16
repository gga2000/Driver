import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PROCESS_ROLE, runsJobs, type ProcessRole } from '../../shared/process-role.js';
import { ChatService } from '../chat/index.js';

/**
 * Often enough that a voice note goes within minutes of its chat closing (the chat closes 30 minutes
 * after the order or ride, the support chat 24 hours after).
 */
export const VOICE_NOTE_PURGE_EVERY_MS = 5 * 60_000;
/** Threads per page: each is an order read, then a storage delete and a row update per note. */
export const VOICE_NOTE_PURGE_BATCH = 100;

/**
 * Ride ideas n7/n8 (Ali: "gone with the chat when it closes"): a chat's voice notes are deleted from
 * storage once the thread is closed; the message keeps its length and the bubble says the note is gone.
 * Runs in every instance that runs jobs (DRIVER_ROLE all or worker); a note already deleted is simply not found again.
 */
@Injectable()
export class VoiceNoteRetention implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VoiceNoteRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly chat: ChatService,
    @Optional() @Inject(PROCESS_ROLE) private readonly role: ProcessRole = 'all',
  ) {}

  onModuleInit(): void {
    // Purges are background work: on DRIVER_ROLE=web machines the worker runs them.
    if (!runsJobs(this.role)) return;
    this.timer = setInterval(() => void this.safeTick(), VOICE_NOTE_PURGE_EVERY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Deletes the voice notes of every closed chat; returns how many went. */
  tick(): Promise<number> {
    return this.chat.purgeClosedVoice(VOICE_NOTE_PURGE_BATCH);
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.tick();
      if (n > 0) this.logger.log(`voice note retention: deleted ${n} voice notes of closed chats`);
    } catch (err) {
      this.logger.error(`voice note retention failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }
}
