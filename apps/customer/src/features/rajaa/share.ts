import { API_URL } from '@/lib/api';

/**
 * Absolute share-trip link from the pass's `sharePath`.
 * TODO(share): the public share page and its domain are not decided yet; until then the link points
 * at `EXPO_PUBLIC_SHARE_BASE_URL`, falling back to the API's origin.
 */
export function shareUrl(path: string): string {
  const base = process.env.EXPO_PUBLIC_SHARE_BASE_URL || API_URL.replace(/\/trpc\/?$/, '');
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
