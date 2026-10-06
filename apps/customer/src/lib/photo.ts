import { absoluteUrl } from '@/features/account/geo';
import { API_URL } from '@/lib/api';

/**
 * A photo URL the API returned (a driver's approved main photo, a child's photo): short-lived and
 * signed, relative to the API origin with the dev storage. Null stays null, so cards fall back to the
 * initial.
 */
export function apiPhoto(url: string | null | undefined): string | null {
  return url ? absoluteUrl(url, API_URL) : null;
}
