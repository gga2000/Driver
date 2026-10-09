import type { InboxCounts, OnCallNow, RightNow } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';

export type GlanceTone = 'ok' | 'warn' | 'bad';

export interface GlanceVerdict {
  tone: GlanceTone;
  key: MessageKey;
  n: number;
}

/**
 * h8, the one line at the top of the phone summary: the worst thing in the city right now, in words.
 * An open SOS beats nobody holding SOS, which beats late orders, which beats problems nobody took.
 * Null while the numbers are still loading, so the page never says "all calm" before it knows.
 */
export function glanceVerdict(
  counts: Pick<InboxCounts, 'byKind' | 'unassigned'> | undefined,
  now: Pick<RightNow, 'lateOrders'> | undefined,
  sos: Pick<OnCallNow, 'fallbackToAdmins'> | undefined,
): GlanceVerdict | null {
  if (!counts || !now) return null;
  const sosOpen = counts.byKind.sos ?? 0;
  if (sosOpen > 0) return { tone: 'bad', key: 'console.glance.verdict_sos', n: sosOpen };
  if (sos?.fallbackToAdmins) return { tone: 'bad', key: 'console.glance.verdict_nobody_sos', n: 0 };
  if (now.lateOrders > 0) return { tone: 'warn', key: 'console.glance.verdict_late', n: now.lateOrders };
  if (counts.unassigned > 0) return { tone: 'warn', key: 'console.glance.verdict_unowned', n: counts.unassigned };
  return { tone: 'ok', key: 'console.glance.verdict_calm', n: 0 };
}
