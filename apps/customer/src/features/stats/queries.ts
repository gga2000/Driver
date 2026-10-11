import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { MonthKey, StatsPeriod } from '@driver/contracts';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** «دفترك ويا درايفر»: the person's own numbers for a period (the server counts every one). */
export function useStats(period: StatsPeriod, month: MonthKey | undefined) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.wallet.stats.queryOptions(period === 'month' && month ? { period, month } : { period }),
    enabled: signedIn,
    placeholderData: keepPreviousData,
  });
}
