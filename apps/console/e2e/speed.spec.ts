import { expect, test, type Page } from '@playwright/test';

/**
 * Speed (build plan §6, gate C7): on a modest office connection the busiest pages show their content
 * within 3 s cold and 1.5 s warm (largest contentful paint), and opening search answers a key press
 * within 200 ms (the slowest event's duration, the INP measure). The JS weight per page is checked
 * separately, from the build (scripts/bundle-budget.mjs).
 */
const NETWORK = { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 };
const PAGES = ['/dispatch', '/orders', '/support'];
const COLD_MS = 3000;
const WARM_MS = 1500;
const INP_MS = 200;

async function throttle(page: Page, cache: boolean) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: !cache });
  return cdp;
}

/** Largest contentful paint of the current document, once the page has settled. */
async function lcp(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) last = Math.max(last, e.startTime);
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolve(last), 1500);
      }),
  );
}

for (const path of PAGES) {
  test(`${path}: content within ${COLD_MS / 1000} s cold and ${WARM_MS / 1000} s warm`, async ({ page }) => {
    const cdp = await throttle(page, false);
    await page.goto(path, { waitUntil: 'load' });
    const cold = await lcp(page);

    await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
    await page.goto(path, { waitUntil: 'load' }); // fills the cache
    await page.goto(path, { waitUntil: 'load' });
    const warm = await lcp(page);

    test.info().annotations.push({ type: 'speed', description: `${path} cold ${Math.round(cold)} ms, warm ${Math.round(warm)} ms` });
    expect(cold, 'cold largest contentful paint (ms)').toBeLessThanOrEqual(COLD_MS);
    expect(warm, 'warm largest contentful paint (ms)').toBeLessThanOrEqual(WARM_MS);
  });
}

test(`opening search answers within ${INP_MS} ms`, async ({ page }) => {
  await throttle(page, true);
  await page.goto('/orders', { waitUntil: 'load' });
  await page.locator('#main').waitFor();
  await page.evaluate(() => {
    const w = window as unknown as { __slowest: number };
    w.__slowest = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__slowest = Math.max(w.__slowest, e.duration);
    }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.type('طلب');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const slowest = await page.evaluate(() => (window as unknown as { __slowest: number }).__slowest);
  test.info().annotations.push({ type: 'speed', description: `slowest interaction ${Math.round(slowest)} ms` });
  expect(slowest, 'slowest interaction (ms)').toBeLessThanOrEqual(INP_MS);
});
