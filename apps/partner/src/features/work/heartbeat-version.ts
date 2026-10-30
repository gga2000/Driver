import type { PartnerGoOnlineResult, PartnerStatus } from '@driver/contracts';

/**
 * Perf o4: the heartbeat's version handling, kept pure. The app holds the version the last heartbeat
 * answered with, and when the cached status was set from it; only while the cache still holds that very
 * status (nothing re-read it since) is the version sent. Otherwise "" goes, and the server answers with
 * the full status.
 */
export interface HeldVersion {
  version: string;
  /** The status cache's `dataUpdatedAt` right after it was set from this version. */
  updatedAt: number;
}

/** What to send as `knownVersion`: the held version while the cache is its status, else "". */
export function versionToSend(held: HeldVersion | null, cacheUpdatedAt: number): string {
  return held && held.updatedAt === cacheUpdatedAt ? held.version : '';
}

/** What to do with the cached status on a heartbeat's answer. */
export type HeartbeatStep =
  /** Put this status in the cache; remember `version` (null: an older server, no version). */
  | { kind: 'replace'; status: PartnerStatus; version: string | null }
  /** Unchanged: keep the cached status, with the position just sent; the version stays. */
  | { kind: 'keep'; position: { lat: number; lng: number }; version: string }
  /** Unchanged, but the cache was re-read meanwhile: leave it, and forget the version. */
  | { kind: 'forget' };

export function heartbeatStep(res: PartnerGoOnlineResult, sent: { lat: number; lng: number }, held: HeldVersion | null, cacheUpdatedAt: number): HeartbeatStep {
  // An older server answers with the full status (it ignores `knownVersion`).
  if (!('changed' in res)) return { kind: 'replace', status: res, version: null };
  if (res.changed) return { kind: 'replace', status: res.status, version: res.version };
  return held?.updatedAt === cacheUpdatedAt ? { kind: 'keep', position: sent, version: res.version } : { kind: 'forget' };
}
