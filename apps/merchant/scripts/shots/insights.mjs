// Wave 2 insights shots: prep honesty, rejection rate with its weekly trend, peak hours (heatmap on a
// tablet, hourly bars on a phone), best sellers and item ratings. Seeded by scripts/demo/insights.mjs.
import { scrollPage } from './money.mjs';

export default {
  name: 'insights',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, viewport } = h;
    const phone = viewport === 'phone';
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-money' : 'nav-money').click();
    await byTestId('segment-insights').click();
    await byTestId('insights-prep').waitFor({ timeout: 20_000 });
    await shot('insights', { wait: 1500 });
    for (const [i, f] of (phone ? [0.25, 0.5, 0.75, 1] : [0.55, 1]).entries()) {
      await scrollPage(page, 'money', f);
      await shot(`insights-${i + 2}`);
    }
    await scrollPage(page, 'money', 0);
    await byTestId('segment-7').click();
    await page.waitForTimeout(1500);
    await shot('insights-7d');
    await byTestId('segment-30').click();
  },
};
