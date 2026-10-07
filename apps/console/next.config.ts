import path from 'node:path';
import type { NextConfig } from 'next';
import { writeConsoleLocales } from './scripts/locale-subset.mjs';

// NEXT_OUTPUT=standalone (apps/console/Dockerfile, docs/deploy/console.md): a self-contained
// `.next/standalone` server with only the files it needs, traced from the monorepo root. Unset (dev,
// CI's `next build`): the normal output.
const standalone = process.env['NEXT_OUTPUT'] === 'standalone';

let locales: { arPath: string; enPath: string } | undefined;
/** Written once per build (the server, client and edge compiles share it). */
function consoleLocales() {
  locales ??= writeConsoleLocales({
    repoRoot: path.resolve(process.cwd(), '../..'),
    outDir: path.resolve(process.cwd(), 'node_modules/.cache/console-locale'),
  });
  return locales;
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@driver/contracts', '@driver/design-tokens', '@driver/i18n', '@driver/map'],
  env: {
    NEXT_PUBLIC_API_URL: process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3000/trpc',
  },
  // Production builds ship only the Arabic strings the Console uses (scripts/locale-subset.mjs);
  // `next dev` keeps the full tables so a newly added key shows without a restart.
  webpack(config, { dev, webpack }) {
    if (dev) return config;
    // The shared packages have no import-time side effects, so a page keeps only the modules it uses
    // (the contracts barrel was 55 KB of schemas on every page). Scoped here, not in their package.json,
    // because Metro and the API load them differently.
    config.module.rules.push({ test: /[\\/]packages[\\/](contracts|i18n|map)[\\/]dist[\\/]/, sideEffects: false });
    const { arPath, enPath } = consoleLocales();
    const swap = (file: RegExp, to: string) =>
      new webpack.NormalModuleReplacementPlugin(file, (res: { request: string; context: string }) => {
        if (/[\\/]i18n[\\/]/.test(res.context)) res.request = to;
      });
    config.plugins.push(swap(/[\\/]locales[\\/]ar-IQ\.json$/, arPath), swap(/[\\/]locales[\\/]en\.json$/, enPath));
    return config;
  },
  ...(standalone ? { output: 'standalone' as const, outputFileTracingRoot: path.resolve(process.cwd(), '../..') } : {}),
  // Staff-only tool: never framed, never indexed.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The Content-Security-Policy (with frame-ancestors) comes from src/middleware.ts, per request.
          // `next dev` only: the local Driver Studio (pnpm studio, localhost:4000) shows the Console in a frame.
          ...(process.env['NODE_ENV'] === 'development' ? [] : [{ key: 'X-Frame-Options', value: 'DENY' }]),
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Cross-origin requests carry the bare origin (never the path, so no order/person ids leak):
          // the OSM tile servers refuse map tiles requested with no Referer at all ("Access blocked").
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
