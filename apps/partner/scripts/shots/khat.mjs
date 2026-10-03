// Wave-2 khat shots: today's run (stops, children, tap-in/out, absence), a substitute offer, the summary.
export const name = 'khat';

export default async function run(s) {
  await s.demoPost('/demo/khat/seed?who=khat');
  const p = await s.signIn('0770 111 0004');

  await p.goto('/khat');
  await p.wait('khat-run');
  await p.wait('khat-place-0');
  await p.shot('run', { settle: 1500 });
  await p.shot('run-full', { full: true, settle: 400 });

  // مريم gets in at الشكري.
  const tap = p.page.locator('[data-testid^="khat-tap-"]').first();
  await tap.click();
  await p.page.getByText('صعد ✓').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  await p.shot('tapped-in', { settle: 1200 });

  // فاطمة is absent today: the reason sheet.
  const absent = p.page.locator('[data-testid^="khat-absent-"]').first();
  await absent.scrollIntoViewIfNeeded();
  await absent.click();
  await p.wait('khat-absence-panel');
  await p.byTestId('khat-absence-panel').scrollIntoViewIfNeeded();
  await p.shot('absence', { settle: 500 });
  await p.byTestId('khat-reason-sick').click();
  await p.page.waitForTimeout(1500);
  await p.shot('after-absence', { full: true, settle: 800 });

  // The rest of the run through the buttons (tap in at زاكور, tap out at the school): the summary.
  for (let i = 0; i < 12; i++) {
    if (await p.byTestId('khat-done').isVisible().catch(() => false)) break;
    const next = p.page.locator('[data-testid^="khat-tap-"]').first();
    if (!(await next.isVisible().catch(() => false))) {
      await p.page.waitForTimeout(800);
      continue;
    }
    await next.click({ timeout: 3000 }).catch(() => undefined);
    await p.page.waitForTimeout(1200);
  }
  await p.wait('khat-done');
  await p.page.evaluate(() => document.querySelector('[data-testid="khat-progress"]')?.scrollIntoView({ block: 'start' }));
  await p.shot('done', { settle: 1200 });
  await p.close();
}
