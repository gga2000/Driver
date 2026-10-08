// Wave-2 khat shots, child-safe run (S-6): today's run (next stop time, chips, children with a guardian
// call), tap-in (substitute offers step aside once he is driving children), absence, the guardian
// call, the two-step "no child left in the car" sweep (step 1 waits 3 s: "باوع زين… 3"), and the summary.
export const name = 'khat';

export default async function run(s) {
  await s.demoPost('/demo/khat/seed?who=khat');
  const p = await s.signIn('0770 111 0004');

  await p.goto('/khat');
  await p.wait('khat-run');
  await p.wait('khat-place-0');
  await p.shot('run', { settle: 1500 });
  await p.shot('run-full', { full: true, settle: 400 });

  // مريم gets in at الشكري: the run is under way, the offers fold into one quiet line.
  // k2/k3: the next child big on top, «بالسيارة» with «غياب اليوم» beside it.
  await p.wait('khat-next');
  const tap = p.byTestId('khat-next-tap');
  await tap.click();
  await p.page.locator('[data-testid^="khat-settled-"]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
  await p.page.waitForTimeout(1200);
  await p.shot('tapped-in', { settle: 1200 });

  // The guardian call on a child's row (development API: the number is shown in the toast).
  const call = p.page.locator('[data-testid^="khat-call-"]').first();
  await call.scrollIntoViewIfNeeded();
  await call.click();
  await p.page.waitForTimeout(1200);
  await p.shot('call', { settle: 300 });

  // فاطمة is absent today: the reason sheet.
  const absent = p.page.locator('[data-testid="khat-next-absent"], [data-testid^="khat-absent-"]').first();
  await absent.scrollIntoViewIfNeeded();
  await absent.click();
  await p.wait('khat-absence-panel');
  await p.byTestId('khat-absence-panel').scrollIntoViewIfNeeded();
  await p.shot('absence', { settle: 500 });
  await p.byTestId('khat-reason-sick').click();
  await p.page.waitForTimeout(1500);
  await p.shot('after-absence', { full: true, settle: 800 });

  // The rest of the run through the buttons (tap in at زاكور, tap out at the school): the sweep.
  for (let i = 0; i < 12; i++) {
    if (await p.byTestId('khat-sweep').isVisible().catch(() => false)) break;
    const next = p.page.locator('[data-testid="khat-next-tap"], [data-testid^="khat-tap-"]').first();
    if (!(await next.isVisible().catch(() => false))) {
      await p.page.waitForTimeout(800);
      continue;
    }
    await next.click({ timeout: 3000 }).catch(() => undefined);
    await p.page.waitForTimeout(1200);
  }
  await p.wait('khat-sweep');
  await p.byTestId('khat-sweep').scrollIntoViewIfNeeded();
  // Step 1's forced pause (KHAT_RULES.sweepLookPauseSec): "باوع زين… 3", disabled, the bar filling.
  await p.shot('sweep-wait', { settle: 150 });
  await p.page.waitForFunction(() => document.querySelector('[data-testid="khat-sweep-looked"]')?.getAttribute('aria-disabled') !== 'true', null, { timeout: 10_000 });
  await p.shot('sweep-look', { settle: 400 });
  // Reduce motion: the same wait and countdown, no filling bar (the screen reloads at step 1).
  await p.page.emulateMedia({ reducedMotion: 'reduce' });
  await p.reload();
  await p.wait('khat-sweep');
  await p.byTestId('khat-sweep').scrollIntoViewIfNeeded();
  await p.shot('sweep-wait-reduced', { settle: 150 });
  // Back to motion (the slide below is a hold under reduce motion), step 1 again after the reload.
  await p.page.emulateMedia({ reducedMotion: 'no-preference' });
  await p.reload();
  await p.wait('khat-sweep');
  await p.page.waitForFunction(() => document.querySelector('[data-testid="khat-sweep-looked"]')?.getAttribute('aria-disabled') !== 'true', null, { timeout: 10_000 });
  await p.byTestId('khat-sweep-looked').click();
  await p.wait('khat-sweep-slide');
  await p.byTestId('khat-sweep').scrollIntoViewIfNeeded();
  await p.shot('sweep-slide', { settle: 600 });
  await p.slide('khat-sweep-slide');
  await p.wait('khat-done');
  // The screen scrolls back to the top by itself: the run's summary card, then "خلص خط اليوم".
  await p.shot('done', { settle: 1200 });
  await p.close();
}
