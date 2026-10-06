// «منطقة التوصيل» (maps r5) and «منين زبائنك» on الإحصائيات (r6): the fee map fitted to the screen with
// its hint, a zone tapped on the map (the list scrolls to its row and highlights it), the customers'
// map with its legend (grey = too few orders to name), and a zone tapped there. Seeded by the core
// demo (zones, fees) and scripts/demo/insights.mjs (delivered orders per zone).
import { scrollPage } from './money.mjs';

/** A zone far down both lists, so tapping it on the map has to scroll to its row. */
const FAR_ZONE = 'khamas';

export default {
  name: 'area',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, goto } = h;
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();

    await goto('/delivery-area');
    await byTestId('delivery-area-map').waitFor({ timeout: 20_000 });
    await shot('area-default', { wait: 1200 });
    await page.locator(`[data-testid="delivery-area-map"] [data-testid="zone-${FAR_ZONE}"]`).click();
    await shot('area-zone-tapped', { wait: 1200 });

    await goto('/insights');
    await byTestId('insights-customers-map').waitFor({ timeout: 20_000 });
    await scrollPage(page, 'insights', 0);
    // The panel's top at the top of the scroll area: the whole map and its legend on one screen.
    await byTestId('insights-customers').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('customers', { wait: 1200 });
    await page.locator(`[data-testid="insights-customers-map"] [data-testid="zone-${FAR_ZONE}"]`).click();
    await shot('customers-zone-tapped', { wait: 1200 });
  },
};
