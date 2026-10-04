import path from 'node:path';
import type { NextConfig } from 'next';

// NEXT_OUTPUT=standalone (apps/console/Dockerfile, docs/deploy/console.md): a self-contained
// `.next/standalone` server with only the files it needs, traced from the monorepo root. Unset (dev,
// CI's `next build`): the normal output.
const standalone = process.env['NEXT_OUTPUT'] === 'standalone';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@driver/contracts', '@driver/design-tokens', '@driver/i18n', '@driver/map'],
  env: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc',
  },
  ...(standalone ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '../..') } : {}),
  // Staff-only tool: never framed, never indexed.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // `next dev` only: the local Driver Studio (pnpm studio, localhost:4000) shows the Console in a frame.
          ...(process.env['NODE_ENV'] === 'development'
            ? [{ key: 'Content-Security-Policy', value: "frame-ancestors 'self' http://localhost:4000" }]
            : [{ key: 'X-Frame-Options', value: 'DENY' }]),
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
