import { useQuery } from '@tanstack/react-query';
import { TOWN_PULSE_RULES } from '@driver/contracts/town-pulse';
import { liteInterval, useLiteMode } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * «المدينة حيّة»: the town picture around him, read at the server's pace (one picture per 20 s, three
 * times slower in low-data mode) and only while he is online with the app in front (react-query stops
 * the interval in the background). Offline he sees the plain map.
 */
export function useTownPulse(online: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  const lite = useLiteMode();
  const ms = liteInterval(TOWN_PULSE_RULES.snapshotMs, lite);
  return useQuery({
    ...api.partner.townPulse.queryOptions(),
    enabled: signedIn && online,
    refetchInterval: online ? ms : false,
    refetchIntervalInBackground: false,
    staleTime: ms / 2,
  });
}

/** «يومي»: his own jobs today, read when he opens it (and kept fresh for a minute). */
export function useMyDay(open: boolean) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.partner.myDay.queryOptions(),
    enabled: signedIn && open,
    staleTime: 60_000,
  });
}
