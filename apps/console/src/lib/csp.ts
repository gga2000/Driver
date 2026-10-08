/**
 * Content-Security-Policy for the Console (CON-06, build plan E0). Staff screens hold money and
 * personal data, so a script the page didn't ship must not run: scripts come only from the Console
 * itself or carry this request's nonce (Next.js stamps its own inline scripts with it; the root
 * layout stamps the pre-paint script). Pure so it can be tested; `src/middleware.ts` sends it.
 */
import { RTL_TEXT_PLUGIN_URL } from '@driver/map';

export interface CspOptions {
  nonce: string;
  /** The API's tRPC URL (`NEXT_PUBLIC_API_URL`): calls and the live stream go there. */
  apiUrl: string;
  /** `next dev`: hot reload needs eval and a websocket; the local studio frames the Console. */
  dev: boolean;
}

/**
 * The one outside script the map loads: the RTL text plugin (packages/map/src/style.ts). Pinned to
 * that exact file, never the whole host: unpkg serves every npm package, so allowing the host would
 * let injected markup load anyone's script and defeat the nonce.
 */
const MAP_SCRIPTS = [RTL_TEXT_PLUGIN_URL];

export function buildCsp({ nonce, apiUrl, dev }: CspOptions): string {
  let api = "'self'";
  try {
    api = new URL(apiUrl).origin;
  } catch {
    /* relative or missing: same origin */
  }
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, ...MAP_SCRIPTS, ...(dev ? ["'unsafe-eval'"] : [])],
    // React and the map set style attributes; styles can't run code.
    'style-src': ["'self'", "'unsafe-inline'"],
    // Map tiles, glyphs and styles come from map hosts that change as the map work lands, and
    // photos from the API or the storage bucket: any https host may be read, never executed.
    'img-src': ["'self'", api, 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:', 'https:'],
    'connect-src': ["'self'", api, 'https:', ...(dev ? ['ws:', 'http://localhost:*'] : [])],
    'worker-src': ["'self'", 'blob:'],
    'child-src': ["'self'", 'blob:'],
    'media-src': ["'self'", api, 'blob:', 'https:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': dev ? ["'self'", 'http://localhost:4000'] : ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${[...new Set(v)].join(' ')}`)
    .join('; ');
}

/** 128 random bits, base64. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
