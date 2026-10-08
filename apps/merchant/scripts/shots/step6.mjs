// Counter step 6: the first day and the bad moments. The one-minute lesson and the practice order
// (s1/s2), the power-back check (y3), «صار جاهز» with no net (y6), big ticket text (s6) and the
// dish photo library. Seeded by scripts/demo/board.mjs (مطعم خالد).
export default {
  name: 'step6',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    const visible = (sel) => page.locator(`${sel}:visible`).first();
    const segment = async (col) => {
      if (phone) await byTestId(`segment-${col}`).click();
    };

    // First sign-in on this device: three cards, then a practice order.
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/printer?state=connected');
    await signIn('0770 123 4567', { lesson: true });
    await byTestId('learn-cards').waitFor({ timeout: 15_000 });
    await shot('lesson', { wait: 900 });

    await byTestId('learn-practice').click();
    if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    await byTestId('practice-tag-0000').waitFor({ timeout: 10_000 });
    if (!(await visible('[data-testid="accept-0000"]').isVisible().catch(() => false))) await visible('[data-testid="row-0000"]').click();
    await shot('practice-rings', { wait: 900 });
    await visible('[data-testid="accept-0000"]').click();
    if (await byTestId('accept-confirm').waitFor({ timeout: 2000 }).then(() => true, () => false)) await byTestId('accept-confirm').click();
    await page.waitForTimeout(3200);
    await segment('preparing');
    await shot('practice-cooking', { wait: 600 });
    await visible('[data-testid="ready-0000"]').click();
    await segment('ready');
    await byTestId('pass-0000').waitFor({ timeout: 10_000 });
    await byTestId('practice-tag-0000').scrollIntoViewIfNeeded();
    await shot('practice-pass', { wait: 600 });
    await byTestId('handed-0000').click();
    await page.waitForTimeout(3600);
    await shot('practice-done', { wait: 300 });
    await segment('new');

    // The power came back after 6 minutes: sound, net and printer before the next order rings.
    await page.evaluate(() => {
      const kept = JSON.parse(localStorage.getItem('driver.merchant.shift') ?? 'null');
      if (kept) localStorage.setItem('driver.merchant.shift', JSON.stringify({ ...kept, aliveAt: Date.now() - 6 * 60_000 - 5_000 }));
    });
    await page.reload({ waitUntil: 'load' });
    await byTestId('power-back').waitFor({ timeout: 20_000 });
    await shot('power-back', { wait: 900 });
    await h.startShift();

    // No net: «صار جاهز» is kept on the tablet and goes out when the net is back.
    await segment('preparing');
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new window.Event('offline')));
    await byTestId('offline-strip').waitFor({ timeout: 15_000 });
    const ready = visible('[data-testid^="ready-"]');
    const number = (await ready.getAttribute('data-testid')).replace('ready-', '');
    await ready.click();
    await segment('ready');
    await byTestId(`queued-${number}`).waitFor({ timeout: 5_000 });
    await shot('offline-ready', { wait: 500 });
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new window.Event('online')));
    await byTestId(`queued-${number}`).waitFor({ state: 'detached', timeout: 40_000 });
    await shot('online-sent', { wait: 500 });
    await segment('new');

    // Big ticket text, from the settings.
    await h.goto('/settings');
    await byTestId('setting-bigtext').click();
    await shot('settings', { wait: 400 });
    await h.goto('/');
    await segment('preparing');
    await shot('big-text', { wait: 800 });
    await h.goto('/settings');
    await byTestId('setting-bigtext').click();
    await h.goto('/');

    // A dish with no photo: pick one from Driver's library.
    await h.goto('/menu/item');
    await byTestId('item-editor').waitFor({ timeout: 15_000 });
    await page.locator('[data-testid="item-name"]').locator('xpath=self::input|self::textarea|.//input').first().fill('لفة تكة دجاج');
    await byTestId('photo-from-library').click();
    await byTestId('library-sheet').waitFor();
    await shot('library', { wait: 900 });
    await visible('[data-testid$="-1"][data-testid^="library-"]').click();
    await shot('library-picked', { wait: 400 });
  },
};
