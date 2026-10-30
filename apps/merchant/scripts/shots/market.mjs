// السوق shots (shopping, 2026-10-11): a produce stall's «أسعار اليوم» in the morning (photos, «نفس
// البارحة», a new price, «الباقي كله نفس البارحة», posted) and a bakery's «الفرن» (open, a half-hour
// pause, closed). Demo owners from scripts/demo/market.mjs. `SHOTS=market VIEWPORTS=phone`.
import { fileURLToPath } from 'node:url';

const photo = fileURLToPath(new URL('../../../api/media/food/shop-tomato-1.webp', import.meta.url));

export default {
  name: 'market',
  viewports: ['phone', 'tablet'],
  async run(h) {
    const { page, byTestId, shot, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const tab = (name) => byTestId(phone ? `tab-${name}` : `nav-${name}`).click();
    const open = async () => {
      await byTestId('board').waitFor();
      if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
      await tab('more');
      await page.locator('[data-testid="more-market"]:visible').click();
    };
    const tap = (id) => page.locator(`[data-testid="${id}"]:visible`).first().click();

    // The stall, first thing in the morning: nothing posted yet.
    await signIn('0770 778 0001');
    await byTestId('board').waitFor();
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    await page.locator('[data-testid="market-chip"]:visible').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await shot('board-chip-prices', { wait: 900 });
    await open();
    await page.locator('[data-testid="market-prices"]:visible').waitFor();
    await page.locator('[data-testid^="price-row-"]:visible').first().waitFor();
    await shot('prices-morning', { wait: 1200 });
    const ids = await page.locator('[data-testid^="price-row-"]:visible').evaluateAll((els) => els.map((e) => e.dataset.testid.slice('price-row-'.length)));
    // Today's photo of the tomatoes, a new price, cucumbers the same.
    const chooser = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
    await tap(`price-photo-${ids[0]}`);
    const fc = await chooser;
    if (fc) await fc.setFiles(photo);
    await page.waitForTimeout(2500);
    await tap(`price-new-${ids[0]}`);
    await page.locator(`[data-testid="price-input-${ids[0]}"]:visible`).fill('1000');
    await tap(`price-same-${ids[1]}`);
    await shot('prices-deciding', { wait: 600 });
    if (phone) await shot('prices-deciding-full', { full: true });
    await tap('prices-all-same');
    await shot('prices-all-ready', { wait: 600 });
    await tap('prices-publish');
    await page.waitForTimeout(1500);
    await shot('prices-posted', { wait: 300 });

    // The bakery: open, then a half-hour pause, then closed.
    await signIn('0770 778 0002');
    await open();
    await page.locator('[data-testid="market-oven"]:visible').waitFor();
    await page.locator('[data-testid="oven-card"]:visible').waitFor();
    await shot('oven-open', { wait: 900 });
    if (phone) await shot('oven-open-full', { full: true });
    await tap('oven-pause-30');
    await shot('oven-paused', { wait: 1200 });
    await tap('oven-orders');
    await shot('board-oven-paused', { wait: 900 });
    await tab('more');
    await tap('more-market');
    await page.locator('[data-testid="oven-card"]:visible').waitFor();
    await tap('oven-closed');
    await shot('oven-closed', { wait: 1200 });
    await tap('oven-open');
    await page.waitForTimeout(800);
  },
};
