import { Injectable } from '@nestjs/common';
import type { DeletionBlocker } from '@driver/contracts';

/**
 * W7 account deletion (docs/api/account-deletion.md): what each module adds to it. A module that keeps
 * rows about a person registers one step at start-up (`ErasureRegistry.register` in its `onModuleInit`),
 * so identity never imports it.
 *
 * Deletion runs in two parts. The account closes at once, in one transaction in identity: the person is
 * marked deleted, the vault rows (name, number, contacts, children, the names he gave others), devices,
 * sessions and sign-in codes go, the number is kept only as a peppered hash. Then every step erases or
 * blurs its own tables; `people.erased_at` is set when all of them have finished, and
 * `AccountErasureJob` runs the steps again until then. So each `erase` must be idempotent.
 */
export interface ErasureStep {
  /** The module that owns the tables (named in docs/launch/data-inventory.md). */
  owner: string;
  /**
   * Every table this step erases or blurs for a person, schema-qualified (`public.places`). The
   * inventory test checks each erase/blur table of the inventory is named by exactly one step.
   */
  tables: readonly string[];
  /** What stands in the way of deleting this person now (an open order, money in the wallet). */
  blockers?(personId: string): Promise<DeletionBlocker[]>;
  /** What he gives up by deleting (shown on the consequences screen). */
  forfeits?(personId: string): Promise<{ points?: number }>;
  /**
   * Erases or blurs this person's rows. Runs after the account closed, again on every retry: must be
   * idempotent. Throw `ErasureNotReady` when something must finish first (the job retries later).
   */
  erase?(personId: string, deletedAt: Date): Promise<void>;
}

/** A step that can't run yet (say, an order still on its way); the erasure job tries again later. */
export class ErasureNotReady extends Error {
  constructor(reason: string) {
    super(`erasure not ready: ${reason}`);
    this.name = 'ErasureNotReady';
  }
}

/** The registered steps, in registration order. */
@Injectable()
export class ErasureRegistry {
  private readonly list: ErasureStep[] = [];

  register(step: ErasureStep): void {
    if (this.list.some((s) => s.owner === step.owner)) throw new Error(`erasure step for ${step.owner} registered twice`);
    this.list.push(step);
  }

  steps(): readonly ErasureStep[] {
    return this.list;
  }
}

export { IDENTITY_ERASED_TABLES } from './identity.repository.js';

/** Whether customers may delete their accounts in the app (`accountDeletionFromEnv`). */
export const ACCOUNT_DELETION_ENABLED = Symbol('ACCOUNT_DELETION_ENABLED');

/**
 * `ACCOUNT_DELETION=on|off` (default on; plan 7.6). Off: `check` says unavailable and the screen sends
 * the person to support; `start` and `confirm` refuse with `account_deletion_off`.
 */
export function accountDeletionFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['ACCOUNT_DELETION'] ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * How coarse a deleted person's kept locations become: 0.01° (about 1.1 km in Aziziyah), enough for
 * area statistics, too coarse to find a house. Every module blurs with `blurPin`.
 */
export const ERASURE_GRID_DEG = 0.01;

export function blurPin<P extends { lat: number; lng: number }>(pin: P): { lat: number; lng: number } {
  const snap = (v: number) => Math.round(v / ERASURE_GRID_DEG) * ERASURE_GRID_DEG;
  return { lat: Number(snap(pin.lat).toFixed(2)), lng: Number(snap(pin.lng).toFixed(2)) };
}
