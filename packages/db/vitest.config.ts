import { defineConfig } from 'vitest/config';

/**
 * `unit` (`pnpm test`) is hermetic: DATABASE_URL is blanked inside the workers.
 * `integration` (`pnpm test:integration`) runs `*.integration.test.ts` against a real Postgres+PostGIS;
 * it skips cleanly without DATABASE_URL and fails instead when `CI` is set (docs/ci.md).
 */
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts', '**/node_modules/**'],
          env: { DATABASE_URL: '' },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          globalSetup: ['../../vitest.integration-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
