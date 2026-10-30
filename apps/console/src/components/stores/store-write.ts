'use client';

import { useQueryClient } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { useToast } from '../ui';

/**
 * After any `ops.stores.*` change: the store's menu, setup, status, hours, history and the list are
 * read again, and a failure says why in one toast. Every write is audited by the server.
 */
export function useStoreWrite(storeId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const scope = { merchantOrgId: storeId };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.ops.stores.menu.queryKey(scope) });
    void qc.invalidateQueries({ queryKey: trpc.ops.stores.setup.queryKey(scope) });
    void qc.invalidateQueries({ queryKey: trpc.ops.stores.status.queryKey(scope) });
    void qc.invalidateQueries({ queryKey: trpc.ops.stores.hours.queryKey(scope) });
    void qc.invalidateQueries({ queryKey: trpc.ops.stores.history.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.stores.list.queryKey() });
  };
  return {
    refresh,
    /** `onSuccess`/`onError` for a mutation: refresh, then a short toast. */
    handlers: (saved?: string) => ({
      onSuccess: () => {
        refresh();
        if (saved) toast({ title: saved, tone: 'ok' });
      },
      onError: (e: { message?: string; data?: unknown }) => toast({ title: t('console.stores.save_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  };
}
