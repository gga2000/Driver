import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useApi } from '@/lib/api';
import { season } from '@/lib/season';

/** How often an open app re-reads today's season (public `system.season`). */
export const SEASON_POLL_MS = 5 * 60_000;

/**
 * Keeps `season` in step with the Console's quiet days. Public read, so guests get it too. A failed
 * read keeps the last answer (an ordinary day before the first one). Renders nothing.
 */
export function SeasonWatcher() {
  const api = useApi();
  const q = useQuery(api.system.season.queryOptions({ cityId: 'aziziyah' }, { refetchInterval: SEASON_POLL_MS, staleTime: SEASON_POLL_MS / 2, retry: false }));
  useEffect(() => {
    if (q.data) season.set(q.data);
  }, [q.data]);
  return null;
}
