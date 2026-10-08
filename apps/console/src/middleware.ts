import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, makeNonce } from '@/lib/csp';

/**
 * A fresh CSP nonce per page request (CON-06). Next.js reads the nonce from the request's
 * Content-Security-Policy header and stamps its own inline scripts; the root layout reads `x-nonce`
 * for the pre-paint script.
 */
export function middleware(request: NextRequest) {
  const nonce = makeNonce();
  const csp = buildCsp({
    nonce,
    apiUrl: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc',
    dev: process.env['NODE_ENV'] === 'development',
  });
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  // Pages only: static files, images and prefetches don't need a policy of their own.
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
