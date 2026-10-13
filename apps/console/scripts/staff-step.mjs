// The admin/finance authenticator step after the SMS code (docs/api/staff-totp.md), passed the way a
// person does it, for the browser checks and screenshot scripts that sign in as علي on the demo API:
// the first time it sets the app up (and continues past the recovery codes), after that it types the
// current code. A dev build shows the code with «عبّيه»; a production build hides that strip, so the
// code comes from the demo API (`identity.authenticator.demoCode`, which only a demo API answers).

const SESSION_KEY = 'driver.console.session';

/**
 * @param {import('@playwright/test').Page} page signed in by SMS code, on /login
 * @param {string} api the demo API's origin
 * @param {{ onEnrol?: () => Promise<void>, onRecovery?: () => Promise<void> }} [hooks] screenshot points
 */
export async function passStaffStep(page, api, hooks = {}) {
  const heading = page.getByRole('heading', { name: /تطبيق المصادقة/ });
  const shown = await heading
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  const code = page.locator('input[autocomplete="one-time-code"]').last();
  const fill = page.getByRole('button', { name: /عبّيه/ });
  await fill.waitFor({ timeout: 8_000 }).catch(() => undefined);
  const enrolling = (await page.getByRole('img', { name: /تطبيق المصادقة/ }).count()) > 0;
  if (enrolling && hooks.onEnrol) await hooks.onEnrol();
  if (await fill.count()) await fill.click();
  else await code.fill(await demoCode(page, api));
  await page.getByRole('button', { name: /^ادخل$/ }).click();
  const saved = page.getByRole('button', { name: /حفظتهن/ });
  if (
    await saved
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
  ) {
    if (hooks.onRecovery) await hooks.onRecovery();
    await saved.click();
  }
  return true;
}

/** The demo API's current code for the signed-in person (polled: the first one appears once the app is set up). */
async function demoCode(page, api) {
  for (let i = 0; i < 20; i += 1) {
    const token = await page.evaluate((key) => {
      try {
        return JSON.parse(localStorage.getItem(key) ?? 'null')?.accessToken ?? null;
      } catch {
        return null;
      }
    }, SESSION_KEY);
    if (token) {
      const res = await fetch(`${api}/trpc/identity.authenticator.demoCode`, { headers: { authorization: `Bearer ${token}` } });
      const code = (await res.json())?.result?.data?.json?.code;
      if (code) return code;
    }
    await page.waitForTimeout(500);
  }
  return '';
}
