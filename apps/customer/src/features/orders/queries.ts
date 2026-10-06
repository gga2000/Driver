import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import type { OrderHistoryRow } from '@driver/contracts';
import { cartStore } from '@/features/food/cart-store';
import { useDeliverTo } from '@/features/food/queries';
import { useApi } from '@/lib/api';
import { useSession, useSignedIn } from '@/lib/session';
import { isRunning } from './history';
import { buildReorderCart, type ReorderResult } from './reorder';

/** طلباتي (`orders.history`): own orders newest first, with the restaurant's name and the dishes. */
export function useOrderHistory() {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.orders.history.queryOptions(),
    enabled: signedIn,
    staleTime: 15_000,
    refetchInterval: (q) => (q.state.data?.some((r) => isRunning(r.order)) ? 15_000 : false),
  });
}

/** The signed-in person's id (orders they placed vs. ones they only ate from). */
export function useMyPersonId(): string | null {
  return useSession().session?.personId ?? null;
}

/** A reorder for later (joy s3 «غدا الجمعة»): the slot it is booked for; absent = now. */
export interface ReorderOptions {
  scheduledFor?: Date | null;
}

export type ReorderState =
  | { phase: 'idle' }
  | { phase: 'loading'; row: OrderHistoryRow; scheduledFor: Date | null }
  | { phase: 'ready'; row: OrderHistoryRow; result: ReorderResult; replacing: string | null; scheduledFor: Date | null }
  | { phase: 'error'; row: OrderHistoryRow; scheduledFor: Date | null };

/**
 * "اطلبه مرة ثانية" (C-15): reads the restaurant's menu as it is now (`catalog.menu`, priced for the
 * deliver-to zone), rebuilds the cart from it and hands the result to the sheet, which explains
 * anything that changed before the cart is replaced. Prices are the server's: the menu now, and the
 * cart's quote after.
 */
export function useReorder() {
  const api = useApi();
  const qc = useQueryClient();
  const { dropoff } = useDeliverTo();
  const [state, setState] = useState<ReorderState>({ phase: 'idle' });

  const start = useCallback(
    async (row: OrderHistoryRow, opts: ReorderOptions = {}) => {
      const merchantId = row.order.merchantOrgId;
      if (!merchantId) return;
      const scheduledFor = opts.scheduledFor ?? null;
      setState({ phase: 'loading', row, scheduledFor });
      try {
        await cartStore.load();
        const menu = await qc.fetchQuery({ ...api.catalog.menu.queryOptions({ merchantId, ...(dropoff ? { dropoff } : {}) }), staleTime: 0 });
        const result = buildReorderCart({ order: row.order, items: row.items, menu, savedPeople: cartStore.getSnapshot().people });
        const current = cartStore.getSnapshot().cart;
        const replacing = current.lines.length > 0 && current.merchant ? current.merchant.name : null;
        setState({ phase: 'ready', row, result, replacing, scheduledFor });
      } catch {
        setState({ phase: 'error', row, scheduledFor });
      }
    },
    [api, qc, dropoff],
  );

  /** Puts the rebuilt cart in place (the cart screen quotes it with the server). */
  const confirm = useCallback(() => {
    if (state.phase !== 'ready' || state.result.cart.lines.length === 0) return false;
    cartStore.replaceCart(state.result.cart);
    return true;
  }, [state]);

  const close = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, start, confirm, close };
}
