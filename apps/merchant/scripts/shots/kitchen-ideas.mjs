// Ali's four "yes build them" ideas (2026-10-09): the board's tickets with drinks and sweets in their
// own colour and «ساخن / بارد» marks, «البارد بكيس وحده» under an order that has both (j6 / k4); a new
// drink in the editor with «أضف اختيار السكر» and its filled sheet (k5); and «يخلص قبل وقته» at the top
// of الأرقام (m4). Seeded by scripts/demo/board.mjs and scripts/demo/insights.mjs (مطعم خالد).
import { scrollPage } from './money.mjs';

export default {
  name: 'kitchen-ideas',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, goto } = h;
    await demoPost('/demo/board/store?open=1&busy=0');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId('alarm-snooze').click().catch(() => undefined);
    const pack = byTestId('pack-apart').first();
    await pack.waitFor({ timeout: 15_000 });
    await pack.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot('board', { wait: 900 });

    await goto('/menu/item');
    await page.locator('[data-testid="item-name"]').fill('چاي عراقي');
    await byTestId('group-add-sugar').waitFor();
    await byTestId('group-add-sugar').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot('sugar-button', { wait: 600 });
    await byTestId('group-add-sugar').click();
    await byTestId('group-sheet').waitFor();
    await shot('sugar-sheet', { wait: 900 });

    await goto('/insights');
    await byTestId('insights-sold-out').waitFor({ timeout: 20_000 });
    await scrollPage(page, 'money', 0);
    await shot('sold-out', { wait: 1200 });
  },
};
