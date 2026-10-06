import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/lib/api';
import { useSignedIn } from '@/lib/session';

/** How often the screen looks for news (a visit time set, the photos handed over). */
export const MENU_PHOTOS_POLL_MS = 60_000;

/** The store's photo requests: the running one first, then the latest closed ones. */
export function useMenuPhotoRequests(merchantOrgId: string | null) {
  const api = useApi();
  const signedIn = useSignedIn();
  return useQuery({
    ...api.merchantAdmin.menuPhotos.list.queryOptions({ merchantOrgId: merchantOrgId ?? '' }),
    enabled: signedIn && !!merchantOrgId,
    refetchInterval: MENU_PHOTOS_POLL_MS,
  });
}

/**
 * Owner actions. Every one returns the request as it is now; the list refetches (and an accepted
 * photo changes the menu, so the menu refetches too).
 */
export function useMenuPhotoActions() {
  const api = useApi();
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries(api.merchantAdmin.menuPhotos.list.pathFilter());
  return {
    request: useMutation({ ...api.merchantAdmin.menuPhotos.request.mutationOptions(), onSettled: refresh }),
    cancel: useMutation({ ...api.merchantAdmin.menuPhotos.cancel.mutationOptions(), onSettled: refresh }),
    decide: useMutation({
      ...api.merchantAdmin.menuPhotos.decide.mutationOptions(),
      onSettled: () => {
        refresh();
        void qc.invalidateQueries(api.merchantAdmin.menu.get.pathFilter());
      },
    }),
  };
}
