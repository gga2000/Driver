import { LIVE_RULES } from '@driver/contracts';
import type { LiveMode } from '@driver/contracts/live-client';

/**
 * How often the waiting driver looks for an offer himself (speed audit, day one). While the live
 * channel is up the server pushes the offer at once and this is only the slow safety refetch. While
 * it is down — connecting, or a network that buffers SSE — a food offer lasts 15 s, so the 30 s
 * fallback poll could miss it whole: look every 5 s, so at least 10 s are left to answer.
 * A null answer is a few hundred bytes; this runs only while he is online and the stream is down.
 */
export const OFFER_POLL_DOWN_MS = 5_000;

export function offerPollMs(mode: LiveMode): number {
  return mode === 'live' ? LIVE_RULES.safetyPollMs : OFFER_POLL_DOWN_MS;
}
