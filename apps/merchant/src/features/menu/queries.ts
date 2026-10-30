import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminMenu, AdminMenuItem } from '@driver/contracts';
import { useApi, useApiClient } from '@/lib/api';
import { useSignedIn } from '@/lib/session';
import { patchMenuItem, withAvailability, withSoldOutToday } from './logic';
import { keepPhotoDown } from './photo-down';
import { uploadPhoto, type PickedPhoto } from './photo';

/** The store's own menu (raw toggles, sold-out-today, modifiers). */
export function useMenu(merchantOrgId: string | null, opts: { refetchMs?: number } = {}) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.menu.get.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    staleTime: 10_000,
    ...(opts.refetchMs ? { refetchInterval: opts.refetchMs } : {}),
  });
}

/**
 * Availability and "خلص اليوم" flip on screen at once (optimistic) and roll back if the server says
 * no; every other edit refreshes the menu when it lands.
 */
export function useMenuActions(merchantOrgId: string | null) {
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const key = api.merchantAdmin.menu.get.queryKey({ merchantOrgId: merchantOrgId ?? '' });
  const refresh = () => void qc.invalidateQueries(api.merchantAdmin.menu.get.pathFilter());
  const putItem = (item: AdminMenuItem) => qc.setQueryData<AdminMenu>(key, (m) => (m ? patchMenuItem(m, item.id, (before) => keepPhotoDown(before as AdminMenuItem, item)) : m));

  /** Optimistic edit of one item; the previous menu comes back if the server refuses. */
  function optimistic<I extends { itemId: string }>(apply: (item: AdminMenuItem, input: I) => AdminMenuItem) {
    return {
      onMutate: async (input: I) => {
        await qc.cancelQueries({ queryKey: key });
        const before = qc.getQueryData<AdminMenu>(key);
        if (before) qc.setQueryData<AdminMenu>(key, patchMenuItem(before, input.itemId, (i) => apply(i as AdminMenuItem, input)));
        return { before };
      },
      onError: (_err: unknown, _input: I, ctx: { before?: AdminMenu | undefined } | undefined) => {
        if (ctx?.before) qc.setQueryData(key, ctx.before);
      },
      onSuccess: putItem,
    };
  }

  return {
    setAvailability: useMutation({
      mutationFn: (input: { merchantOrgId: string; itemId: string; available: boolean }) => client.merchantAdmin.menu.setAvailability.mutate(input),
      ...optimistic<{ merchantOrgId: string; itemId: string; available: boolean }>((i, input) => withAvailability(i, input.available)),
    }),
    soldOutToday: useMutation({
      mutationFn: (input: { merchantOrgId: string; itemId: string }) => client.merchantAdmin.menu.soldOutToday.mutate(input),
      ...optimistic<{ merchantOrgId: string; itemId: string }>((i) => withSoldOutToday(i, Date.now())),
    }),
    updatePrice: useMutation({
      ...api.merchantAdmin.menu.updatePrice.mutationOptions(),
      onSuccess: (out) => {
        putItem(out.item);
        qc.setQueryData(api.merchantAdmin.menu.priceHistory.queryKey({ merchantOrgId: merchantOrgId ?? '', itemId: out.item.id }), out.history);
      },
    }),
    upsertItem: useMutation({ ...api.merchantAdmin.menu.upsertItem.mutationOptions(), onSuccess: putItem, onSettled: refresh }),
    setModifiers: useMutation({ ...api.merchantAdmin.menu.setModifiers.mutationOptions(), onSuccess: putItem }),
    replacePhoto: useMutation({ ...api.merchantAdmin.menu.replacePhoto.mutationOptions(), onSuccess: putItem }),
    upsertCategory: useMutation({ ...api.merchantAdmin.menu.upsertCategory.mutationOptions(), onSuccess: (m) => qc.setQueryData(key, m) }),
    reorderCategories: useMutation({ ...api.merchantAdmin.menu.reorderCategories.mutationOptions(), onSuccess: (m) => qc.setQueryData(key, m) }),
  };
}

export function usePriceHistory(merchantOrgId: string | null, itemId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.menu.priceHistory.queryOptions({ merchantOrgId: merchantOrgId ?? '', itemId: itemId ?? '' }),
    enabled: signedIn && !!merchantOrgId && !!itemId,
  });
}

/** Ticket + PUT, returning the upload id the menu calls take. */
export function usePhotoUpload() {
  const client = useApiClient();
  return (photo: PickedPhoto) => uploadPhoto(photo, (input) => client.places.photoUpload.mutate(input));
}

// ───────────────────────── photo import ─────────────────────────

export function useImportJob(merchantOrgId: string | null, jobId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.menu.importJob.queryOptions({ merchantOrgId: merchantOrgId ?? '', jobId: jobId ?? '' }),
    enabled: signedIn && !!merchantOrgId && !!jobId,
  });
}

export function useImportActions() {
  const api = useApi();
  const qc = useQueryClient();
  return {
    start: useMutation({ ...api.merchantAdmin.menu.importFromPhotos.mutationOptions(), onSuccess: (job) => qc.setQueryData(api.merchantAdmin.menu.importJob.queryKey({ merchantOrgId: job.merchantOrgId, jobId: job.jobId }), job) }),
    apply: useMutation({
      ...api.merchantAdmin.menu.applyImport.mutationOptions(),
      onSuccess: (job) => {
        qc.setQueryData(api.merchantAdmin.menu.importJob.queryKey({ merchantOrgId: job.merchantOrgId, jobId: job.jobId }), job);
        void qc.invalidateQueries(api.merchantAdmin.menu.get.pathFilter());
      },
    }),
  };
}
