import { useQuery } from '@tanstack/react-query';
import type { Order } from '@driver/contracts';
import { isActiveOrder } from '@/features/home/queries';
import { isBookedRide } from '@/features/ride-habits/logic';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/**
 * The taxi or tuktuk ride in progress, for the simple home's big card: the newest one still going
 * (a ride booked for later counts once its search starts). Polls while one is on, like home's pill.
 */
export function useActiveRide() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.mine.queryOptions(),
    enabled: signedIn,
    select: (orders: Order[]) =>
      orders
        .filter((o) => o.type === 'ride' && isActiveOrder(o) && !isBookedRide(o, new Date()))
        .sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime())[0] ?? null,
    refetchInterval: (q) =>
      q.state.data?.some((o) => o.type === 'ride' && isActiveOrder(o)) ? 15_000 : false,
  });
}
