'use client';

import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useMemo } from 'react';
import { formatClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { eventTimeline, type LogEntry } from '@/lib/orders';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { PersonName } from './named';
import { Chip, QueryError } from './ui';

/** The actor event log as a vertical timeline; quarantined late replays and skew flags are marked. */
export function EventTimeline({ entries }: { entries: readonly LogEntry[] }) {
  return (
    <ol className="relative space-y-3 border-s border-line ps-5">
      {entries.map((e) => (
        <li key={e.id} className={`relative ${e.quarantined ? 'opacity-70' : ''}`}>
          <span aria-hidden className={`absolute -start-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-pill ${e.quarantined ? 'bg-bad' : e.flagged ? 'bg-accent' : 'bg-accent'}`} />
          <p className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold" title={e.type}>
              {e.label}
            </span>
            <span className="text-xs text-muted tabular-nums">
              {formatClock(e.at)}
              {e.offsetMin > 0 && <> · {t('console.step_offset', { minutes: e.offsetMin })}</>}
            </span>
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-faint">
            <PersonName id={e.actorId} />
            {e.quarantined && (
              <Chip tone="bad" title={e.quarantineReason ?? undefined}>
                {t('console.event_quarantined')}
              </Chip>
            )}
            {e.flagged && (
              <Chip tone="warn" title={e.flagReason ?? undefined}>
                {t('console.event_skew')}
              </Chip>
            )}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** A trip's event log (`trips.events`), polled while open. */
export function TripEventLog({ tripId }: { tripId: string }) {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const log = useQuery(trpc.trips.events.queryOptions({ tripId }, { enabled: signedIn, retry: queryRetry, refetchInterval: 5_000 }));
  const entries = useMemo(() => eventTimeline(log.data ?? []), [log.data]);
  if (log.error) return <QueryError error={log.error} onRetry={() => void log.refetch()} />;
  if (log.isPending) return <p className="text-sm text-muted">{t('status.loading')}</p>;
  if (entries.length === 0) return <p className="text-sm text-muted">{t('console.events_none')}</p>;
  return <EventTimeline entries={entries} />;
}
