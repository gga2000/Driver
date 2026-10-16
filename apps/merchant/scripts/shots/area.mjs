// «منطقة التوصيل» (maps r5) and «منين زباينك» on الإحصائيات (r6): the fee map fitted to the screen with
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
    // The drawn map has a tap target per zone; on the Golden hour street map (web, when the map's
    // addresses are set) the zone is picked from its row instead, and the map outlines it.
    const tapZone = async (map, row) => {
      const onMap = page.locator(`[data-testid="${map}"] [data-testid="zone-${FAR_ZONE}"]`);
      if (await onMap.count()) return onMap.click();
      await byTestId(`${row}-${FAR_ZONE}`).click();
      await shot(`${map === 'delivery-area-map' ? 'area' : 'customers'}-row-tapped`, { wait: 600 });
      await byTestId(map).evaluate((el) => el.scrollIntoView({ block: 'center' }));
    };
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();

    await goto('/delivery-area');
    await byTestId('delivery-area-map').waitFor({ timeout: 20_000 });
    await shot('area-default', { wait: 1200 });
    await tapZone('delivery-area-map', 'delivery-area-row');
    await shot('area-zone-tapped', { wait: 1200 });

    await goto('/insights');
    await byTestId('insights-customers-map').waitFor({ timeout: 20_000 });
    await scrollPage(page, 'money', 0);
    // The panel's top at the top of the scroll area: the whole map and its legend on one screen.
    await byTestId('insights-customers').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await shot('customers', { wait: 1200 });
    await tapZone('insights-customers-map', 'insights-customers-row');
    await shot('customers-zone-tapped', { wait: 1200 });
  },
};
