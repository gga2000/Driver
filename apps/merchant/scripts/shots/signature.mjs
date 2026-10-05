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
    await post('/demo/signature/at-pass?waited=4');
    await page.waitForTimeout(2500);
    await step('at-pass-waiting', async () => {
      await byTestId(`pass-${pass.number}`).waitFor({ timeout: 4000 });
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
  },
};
