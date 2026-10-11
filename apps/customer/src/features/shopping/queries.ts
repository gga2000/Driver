import { useQuery } from '@tanstack/react-query';
import { DEMO_APP_SHOPS, DEMO_FRONT } from './demo';
import type { Bakery, ShoppingFront, Stall } from './model';

/**
 * The shopping side's reads. They answer from the demo shops for now; when the shopping API lands
 * each `queryFn` becomes its tRPC call and the screens stay as they are (loading, error and offline
 * states are already wired through react-query).
 */
async function front(): Promise<ShoppingFront> {
  return DEMO_FRONT;
}

export function useShoppingFront() {
  return useQuery({ queryKey: ['shopping', 'front'], queryFn: front, staleTime: 60_000 });
}

export function useStall(id: string | undefined) {
  return useQuery({
    queryKey: ['shopping', 'stall', id],
    queryFn: async (): Promise<Stall | null> => (await front()).stalls.find((s) => s.id === id) ?? null,
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

export function useBakery(id: string | undefined) {
  return useQuery({
    queryKey: ['shopping', 'bakery', id],
    queryFn: async (): Promise<Bakery | null> => (await front()).bakeries.find((b) => b.id === id) ?? null,
    enabled: Boolean(id),
    staleTime: 60_000,
  });
}

/** The shops in the app a دوّرلي item can be bought from, filtered by what he types. */
export function useAppShops(search: string) {
  return useQuery({
    queryKey: ['shopping', 'app-shops', search.trim()],
    queryFn: async () => {
      const q = search.trim();
      return DEMO_APP_SHOPS.filter((s) => !q || s.name.includes(q) || s.kind.includes(q));
    },
    staleTime: 60_000,
  });
}
