import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Two projects (docs/ci.md):
 *  - `unit`        — `pnpm test`. Hermetic: DATABASE_URL / REDIS_URL are blanked inside the workers, so
 *                    a developer shell or the CI job env never turns a unit run into a database run.
 *  - `integration` — `pnpm test:integration`. Needs Postgres+PostGIS (migrated + seeded) and Redis
 *                    (`pnpm db:up && pnpm db:migrate && pnpm db:seed`). Without them every suite
 *                    skips cleanly; with `CI` set, missing services fail the run instead.
 */
const INTEGRATION = [
  'src/**/*.integration.test.ts',
  'src/**/*.redis.test.ts',
  // Mixed file: in-memory contract tests plus a REDIS_URL-gated RedisGeoIndex block. The in-memory
  // part also runs under `unit`; listed here so the Redis block runs against the real service.
  'src/modules/dispatch/geo-index.test.ts',
];

export default defineConfig({
  // SWC keeps Nest's decorator metadata (emitDecoratorMetadata) which esbuild drops.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    testTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts', 'src/**/*.redis.test.ts', '**/node_modules/**'],
          env: { DATABASE_URL: '', REDIS_URL: '' },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: INTEGRATION,
          globalSetup: ['../../vitest.integration-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          // One shared database and Redis: run files one after another.
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
