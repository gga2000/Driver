import { Platform } from 'react-native';
import { API_URL } from '@/lib/api';

/**
 * Absolute share-trip link from a path the API returns (`tracking.createShareLink` → `/share/<token>`).
 * The public page is this app's web build (`app/share/[token].tsx`), so the base is
 * `EXPO_PUBLIC_SHARE_BASE_URL` (the public web origin, e.g. https://driver.iq); on the web, the
 * origin the app is served from; otherwise the API's origin.
 */
export function shareUrl(path: string): string {
  const webOrigin = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.origin : '';
  const base = process.env.EXPO_PUBLIC_SHARE_BASE_URL || webOrigin || API_URL.replace(/\/trpc\/?$/, '');
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
