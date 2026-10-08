import { defineConfig, devices } from '@playwright/test';

/**
 * The Console's browser checks (CON-13, gate C10): sign in through the real /login page against the
 * demo API, then every page renders without errors or CSP violations, passes axe with 0 serious or
 * critical findings, and is captured at 1366×768 and 1440×900 in both themes.
 *
 *   pnpm --filter @driver/console e2e            # starts the demo API and a production build
 *   CONSOLE_URL=http://localhost:3396 API_URL=http://localhost:3395 pnpm --filter @driver/console e2e
 *                                                # against servers you already run
 *
 * CHROMIUM_PATH points at a local Chromium when Playwright's own download isn't available.
 */
const API_PORT = 3495;
const WEB_PORT = 3496;
const external = Boolean(process.env.CONSOLE_URL);
const CONSOLE = process.env.CONSOLE_URL ?? `http://localhost:${WEB_PORT}`;
const API = process.env.API_URL ?? `http://localhost:${API_PORT}`;
process.env.E2E_API_URL = API;

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './e2e/.report' }]],
  use: {
    baseURL: CONSOLE,
    locale: 'ar-IQ',
    timezoneId: 'Asia/Baghdad',
    trace: 'retain-on-failure',
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'setup', testMatch: /sign-in\.setup\.ts/ },
    {
      name: 'console',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: './e2e/.auth/admin.json' },
    },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: `node scripts/demo-api.mjs`,
          env: { PORT: String(API_PORT) },
          url: `${API}/trpc/health.ping`,
          timeout: 120_000,
          reuseExistingServer: false,
        },
        {
          command: `pnpm exec next build && pnpm exec next start --port ${WEB_PORT}`,
          env: { NEXT_PUBLIC_API_URL: `${API}/trpc` },
          url: `${CONSOLE}/login`,
          timeout: 300_000,
          reuseExistingServer: false,
        },
      ],
});
