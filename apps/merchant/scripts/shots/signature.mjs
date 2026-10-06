// Phase 3 signature moments (UI/UX audit merchant-and-console §8: S-M4, S-M5, S-M6): the courier at
// the pass, the money pill in one line, the weekly bridge and the end-of-day card.
// Seeded by scripts/demo/board.mjs, money.mjs and signature.mjs (hooks below).
//
//   SHOTS=signature VIEWPORTS=tablet node scripts/web-shots.mjs <out>

/** Runs a step; a missing element (older builds, a state that didn't come) skips the shot, not the run. */
async function step(name, fn) {
  try {
    await fn();
  } catch (err) {
    console.log(`  (skipped ${name}: ${String(err?.message ?? err).split('\n')[0]})`);
  }
}

export default {
  name: 'signature',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn, viewport } = h;
    const phone = viewport === 'phone';
    // Hooks that may not exist on an older build: plain fetch, failures ignored.
    const post = async (path) => {
      const r = await fetch(`${h.apiBase}${path}`, { method: 'POST' }).catch(() => null);
      return r?.ok ? r.json().catch(() => null) : null;
    };
    const readyTab = async () => {
      if (phone) await byTestId('segment-ready').click();
    };
    /** The money pill: in the header on a tablet, in the "…" menu on a phone. */
    const pillShot = async (name) => {
      if (!phone) return shot(name, { element: byTestId('cash-balance') });
      await byTestId('header-more').click();
      await byTestId('header-menu').waitFor({ timeout: 5000 });
      await shot(name);
      await byTestId('header-menu-close').click();
      await page.waitForTimeout(400);
    };

    await post('/demo/board/store?open=1&busy=0');
    await post('/demo/signature/balance?kind=owed');
    await post('/demo/board/fresh');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await page.locator('[data-testid^="order-"]').first().waitFor({ timeout: 15_000 });

    // S-M5: the money pill, positive ("إلك … · توصلك الليلة ويا الدليفري").
    await shot('board', { wait: 1200 });
    await step('pill-owed', () => pillShot('pill-owed'));

    // S-M4: the courier at the pass, just arrived (success tint) and then waiting 4 min (warning tint).
    const pass = await post('/demo/signature/at-pass?waited=0');
    await readyTab();
    await page.waitForTimeout(2500);
    const card = () => (pass ? byTestId(`order-${pass.number}`) : page.locator('[data-testid^="order-"]', { hasText: 'وصل' }).first());
    await step('at-pass', async () => {
      await card().scrollIntoViewIfNeeded();
      await shot('at-pass', { element: card() });
    });
    await step('ready-column', async () => shot('ready-column'));
    // The hook moves his arrival time back and nudges the live channel; a reload keeps the shot
    // independent of the live connection. The card must say "حيدر ينتظر من 4 دقايق" before the shot.
    // (That the card turns amber by itself on the open board is pass.test.ts, m2a.)
    await post('/demo/signature/at-pass?waited=4');
    await page.reload({ waitUntil: 'load' });
    await h.startShift();
    await byTestId('board').waitFor({ timeout: 15_000 });
    await readyTab();
    await step('at-pass-waiting', async () => {
      await byTestId(`pass-${pass.number}`).filter({ hasText: 'ينتظر من' }).waitFor({ timeout: 15_000 });
      await page.waitForTimeout(600);
      await card().scrollIntoViewIfNeeded();
      await shot('at-pass-waiting', { element: card() });
    });
    await step('handed-over', async () => {
      await byTestId(`handed-${pass.number}`).click({ timeout: 4000 });
      await byTestId(`handed-done-${pass.number}`).waitFor({ timeout: 6000 });
      await shot('handed-over', { element: card() });
    });
    if (phone) await byTestId('segment-new').click().catch(() => undefined);

    // S-M5: negative ("عليك … عمولة · تنخصم من الجاية") and requested ("فلوسك جاية قبل …").
    await step('pill-owe', async () => {
      if (!(await post('/demo/signature/balance?kind=owe'))) throw new Error('no hook');
      await page.reload({ waitUntil: 'load' });
      await h.startShift();
      await byTestId('board').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(2500);
      await pillShot('pill-owe');
    });
    await step('pill-requested', async () => {
      if (!(await post('/demo/signature/balance?kind=owed'))) throw new Error('no hook');
      await post('/demo/money/request');
      await page.reload({ waitUntil: 'load' });
      await h.startShift();
      await byTestId('board').waitFor({ timeout: 15_000 });
      await page.waitForTimeout(2500);
      await pillShot('pill-requested');
    });

    // S-M6: closing time → the day's summary card on the board.
    await step('day-summary', async () => {
      if (!(await post('/demo/signature/day-summary'))) throw new Error('no hook');
      await page.reload({ waitUntil: 'load' });
      await h.startShift();
      await byTestId('day-summary').waitFor({ timeout: 15_000 });
      await shot('day-summary-board', { wait: 1200 });
      await shot('day-summary', { element: byTestId('day-summary') });
      // "شارك على واتساب" on the web: the drawn 1080×1080 card (a download where Web Share can't take files).
      if (!phone && process.argv[2]) {
        const download = page.waitForEvent('download', { timeout: 10_000 });
        await byTestId('day-share').click();
        const file = await download;
        await file.saveAs(`${process.argv[2]}/${viewport}-signature-day-share-image.png`);
        console.log(`${process.argv[2]}/${viewport}-signature-day-share-image.png`);
      }
      await post('/demo/board/store?open=1&busy=0');
    });

    // M-17 / S-M5: the weekly statement with its bridge row.
    await byTestId(phone ? 'tab-money' : 'nav-money').click();
    await byTestId('money').waitFor();
    await step('money-today', async () => {
      await byTestId('cash-hero').waitFor({ timeout: 15_000 });
      await shot('money-today', { wait: 1200 });
    });
    await step('statement', async () => {
      await byTestId('segment-statement').click();
      await byTestId('statement-summary').waitFor({ timeout: 15_000 });
      await shot('statement', { wait: 1200 });
    });
    await step('statement-bridge', async () => {
      await byTestId('statement-bridge').waitFor({ timeout: 3000 });
      await shot('statement-bridge', { element: byTestId('statement-bridge') });
    });
    // Scrolled to the end, the last row («رصيد آخر الأسبوع») clears the floating "3 طلبات تنتظر" pill.
    await step('statement-end', async () => {
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('div')) if (el.scrollHeight > el.clientHeight + 10 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight;
      });
      await shot('statement-end', { wait: 800 });
    });
  },
};
