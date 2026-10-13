import { mkdirSync } from 'node:fs';
import { expect, test as setup } from '@playwright/test';
import { passStaffStep } from '../scripts/staff-step.mjs';

/** Signs in once as علي (every role) through the real /login page; the pages reuse the session. */
setup('sign in as the admin', async ({ page }) => {
  mkdirSync('e2e/.auth', { recursive: true });
  await page.goto('/login');
  await page.locator('input').first().fill('07700000001');
  await page.getByRole('button').first().click();
  const autofill = page.getByRole('button', { name: /عبّيه/ });
  await autofill.waitFor({ timeout: 15_000 }).catch(() => undefined);
  if (await autofill.count()) {
    await autofill.click();
  } else {
    const api = process.env.E2E_API_URL!;
    const res = await fetch(`${api}/trpc/identity.devLastOtp?input=${encodeURIComponent(JSON.stringify({ json: { phone: '07700000001' } }))}`);
    const code = ((await res.json()) as { result?: { data?: { json?: { code?: string } } } }).result?.data?.json?.code ?? '';
    await page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]').last().fill(code);
  }
  await page.getByRole('button', { name: /^ادخل$/ }).click();
  // Admin and finance: the authenticator step (set up the first time; docs/api/staff-totp.md).
  await passStaffStep(page, process.env.E2E_API_URL!);
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
  await page.context().storageState({ path: 'e2e/.auth/admin.json' });
});
