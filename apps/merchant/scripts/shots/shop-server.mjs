// Shop picks from lane A's server work (PR #75, `docs/api/shop-load.md`) on مطعم خالد's board:
//   h5  «متوقف للزباين»: offline, the count to the pause and the pause itself; back after the app was
//       closed for 12 minutes («جان متوقف حوالي 7 دقيقة»).
//   l4  «زحمة تلقائية · 17 طلب ينتظر»: the strip, the busy sheet's explanation, and with busy mode on too.
//   c6  «أعدنا تسويه»: nothing while the switch is off; with it on (this demo process only) the tag on
//       a ready order 12 minutes old, the sheet, the paid amount and «انحسبت قبل».
// Seeded by scripts/demo/shop-load.mjs and board.mjs.
export default {
  name: 'shop-server',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, startShift, viewport, apiBase } = h;
    const phone = viewport === 'phone';
    const visible = (sel) => page.locator(`${sel}:visible`).first();
    const segment = async (col) => {
      if (phone) await byTestId(`segment-${col}`).click();
    };
    const dayOk = async () => {
      if (await byTestId('day-ok').isVisible().catch(() => false)) await byTestId('day-ok').click();
    };
    const reload = async () => {
      await page.reload({ waitUntil: 'load' });
      await byTestId('board').waitFor({ timeout: 20_000 });
      await startShift();
      await dayOk();
    };
    const seed = await (await fetch(`${apiBase}/demo/seed`)).json();
    const khalid = seed.stores.find((s) => s.key === 'khalid').orgId;

    await demoPost('/demo/shop/crowd?count=0');
    await demoPost('/demo/shop/remake?on=0');
    await demoPost('/demo/board/store?open=1&busy=0');
    await demoPost('/demo/board/fresh');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await dayOk();

    // ── c6: switched off → no remake anywhere ──
    await segment('ready');
    await page.waitForTimeout(1200);
    await shot('remake-off');

    // On (in this demo process only): an order ready 12 minutes, courier still on the way.
    await demoPost('/demo/shop/remake?on=1');
    await reload();
    await segment('ready');
    const tag = visible('[data-testid^="remake-"][data-testid$="-action"]');
    await tag.waitFor({ timeout: 20_000 });
    await tag.scrollIntoViewIfNeeded();
    await shot('remake-tag', { wait: 600 });
    await tag.click();
    await byTestId('remake-sheet').waitFor();
    await shot('remake-sheet', { wait: 600 });
    await byTestId('remake-confirm').click();
    await byTestId('remake-paid').waitFor({ timeout: 10_000 });
    await shot('remake-paid', { wait: 600 });
    await byTestId('remake-done').click();
    await visible('[data-testid^="remade-"]').waitFor({ timeout: 10_000 });
    await visible('[data-testid^="remade-"]').scrollIntoViewIfNeeded();
    await shot('remake-paid-tag', { wait: 500 });
    // A second tap after a restart: «انحسبت قبل».
    await reload();
    await segment('ready');
    const again = visible('[data-testid^="remake-"][data-testid$="-action"]');
    await again.waitFor({ timeout: 20_000 });
    await again.click();
    await byTestId('remake-confirm').click();
    await byTestId('remake-already').waitFor({ timeout: 10_000 });
    await shot('remake-already', { wait: 600 });
    await byTestId('remake-done').click();
    await demoPost('/demo/shop/remake?on=0');
    await segment('new');

    // ── l4: 15+ waiting → «زحمة تلقائية» ──
    await demoPost('/demo/shop/crowd?count=12');
    await byTestId('auto-busy-strip').waitFor({ timeout: 30_000 });
    await shot('auto-busy', { wait: 800 });
    await byTestId('auto-busy-more').click();
    await byTestId('busy-sheet').waitFor();
    await byTestId('busy-auto-now').waitFor();
    await shot('auto-busy-sheet', { wait: 600 });
    await page.keyboard.press('Escape');
    await byTestId('busy-sheet').waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
    // The shop's own busy mode on too: the automatic one adds nothing on top.
    await demoPost('/demo/board/store?open=1&busy=1');
    await page.locator('[data-testid="busy-frame"]').waitFor({ timeout: 30_000 });
    await shot('auto-busy-manual', { wait: 800 });
    await demoPost('/demo/shop/crowd?count=0');
    await demoPost('/demo/board/store?open=1&busy=0');
    await reload();
    await byTestId('auto-busy-strip').waitFor({ state: 'detached', timeout: 30_000 });

    // ── h5: the app comes back after 12 minutes closed → «جان متوقف حوالي 7 دقيقة» ──
    const keepBeat = (agoMin) => page.evaluate(([orgId, at]) => localStorage.setItem('driver.merchant.beat', JSON.stringify({ orgId, at })), [khalid, Date.now() - agoMin * 60_000]);
    await keepBeat(12);
    await reload();
    await byTestId('paused-back-strip').waitFor({ timeout: 20_000 });
    await shot('paused-back', { wait: 600 });
    await byTestId('paused-back-ok').click();
    await byTestId('paused-back-strip').waitFor({ state: 'detached', timeout: 5000 });

    // Offline, on a fake clock so minutes pass in a second: the API stops answering and the app counts
    // from its last answered beat — «إذا ظل بلا نت … بعد», then «المحل متوقف للزباين».
    await page.clock.install();
    await reload();
    await page.waitForTimeout(1500);
    await page.route(`${apiBase}/trpc/**`, (r) => r.abort('internetdisconnected'));
    await page.clock.fastForward('02:00');
    await byTestId('offline-strip').waitFor({ timeout: 20_000 });
    await shot('paused-soon', { wait: 800 });
    await page.clock.fastForward('05:00');
    await byTestId('paused-strip').waitFor({ timeout: 20_000 });
    await shot('paused-now', { wait: 800 });
    // The net is back: the next beat answers and the board says how long customers saw it closed.
    await page.unroute(`${apiBase}/trpc/**`);
    await page.clock.fastForward('00:31');
    await byTestId('paused-back-strip').waitFor({ timeout: 20_000 });
    await shot('paused-back-online', { wait: 600 });
    await byTestId('paused-back-ok').click();
  },
};
