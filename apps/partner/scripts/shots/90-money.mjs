// Money moments + emergency contact (UI/UX audit partner S-3, S-4, S-7, S-8): the readiness row above
// the switch and its sheet, the end-of-job screen (over the cap, then after handing in the cash), the
// end-of-shift summary (hold the switch to go offline), the "why was I paid this" receipt and its
// objection, and the driver's emergency contact.
//
//   SHOTS=money node scripts/web-shots.mjs <out-dir>
//
// Steps that need a screen the build does not have are skipped, so the same list shoots a "before"
// build too. Demo hooks: scripts/demo/80-money.mjs.
export const name = 'money';

const COURIER = '0770 111 0001';

async function has(p, id, timeout = 4000) {
  try {
    await p.wait(id, timeout);
    return true;
  } catch {
    return false;
  }
}

/** Press-and-hold the online switch until it goes offline (a short press never ends a shift). */
async function holdSwitch(p) {
  await p.page.waitForTimeout(1500);
  const box = await p.byTestId('online-switch').boundingBox();
  if (!box) throw new Error('online-switch: not on screen');
  await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.page.mouse.down();
  await p.page.waitForTimeout(1800);
  await p.page.mouse.up();
}

async function doneJob(s, c) {
  await s.demoPost('/demo/job?who=courier&step=at_dropoff');
  await c.goto('/job');
  await c.wait('job-action');
  await c.byTestId('job-action').click();
  await c.wait('handover-panel');
  await c.slide('handover-confirm');
  await c.wait('job-done');
}

/** Scrolls the screen's column to its end with the mouse wheel (the summary and receipts are taller than a phone). */
async function scrollEnd(p) {
  await p.page.mouse.move(195, 400);
  for (let i = 0; i < 6; i++) {
    await p.page.mouse.wheel(0, 600);
    await p.page.waitForTimeout(80);
  }
  await p.page.waitForTimeout(400);
}

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(COURIER);
  await c.wait('online-switch');
  // Location not allowed yet: the readiness row says so and its sheet offers the fix.
  if (await has(c, 'readiness', 3000)) {
    await c.shot('home-offline-gps-ask', { settle: 1500 });
    await c.byTestId('readiness').click();
    await c.wait('readiness-sheet');
    await c.shot('readiness-sheet-gps-ask', { settle: 700 });
    await c.byTestId('readiness-close').click();
    await c.page.waitForTimeout(400);
  }
  // The phone allows location (the row reads the permission; it never prompts by itself).
  await c.context.grantPermissions(['geolocation']);
  await c.context.setGeolocation({ latitude: 32.9138, longitude: 45.0592 });
  await c.reload();
  await c.wait('online-switch');
  await c.shot('home-offline', { settle: 1800 });
  if (await has(c, 'readiness', 1500)) {
    await c.byTestId('readiness').click();
    await c.wait('readiness-sheet');
    await c.shot('readiness-sheet', { settle: 700 });
    await c.byTestId('readiness-close').click();
    await c.page.waitForTimeout(400);
  }

  await c.byTestId('online-switch').click();
  await c.page.getByText('شغّال، ندورلك طلب').waitFor({ timeout: 15_000 });
  await c.shot('home-online', { settle: 2500 });

  // End of job, near / over the cash cap: the settle card, no "go get more" chip.
  await doneJob(s, c);
  if (await has(c, 'done-stay', 1500)) await c.byTestId('done-stay').click();
  await c.shot('job-done', { settle: 1800 });

  // End of shift: a shift that started 5 hours ago; hold the switch to go offline.
  await s.demoPost('/demo/clear?who=courier');
  const shift = await fetch(`${s.apiBase}/demo/money/shift?who=courier&hours=5`, { method: 'POST' }).then((r) => r.ok).catch(() => false);
  if (!shift) await s.demoPost('/demo/online?who=courier');
  await c.goto('/');
  await c.wait('online-switch');
  await c.page.getByText('شغّال، ندورلك طلب').waitFor({ timeout: 15_000 });
  await holdSwitch(c);
  if (!(await has(c, 'shift-summary', 6000))) await holdSwitch(c);
  if (await has(c, 'shift-summary', 8000)) {
    await c.wait('shift-hero', 10_000);
    await c.shot('shift-summary', { settle: 1800 });
    // "شارك يومك": a desktop browser can't share files, so the picture downloads; keep it next to the shots.
    if (await has(c, 'shift-share', 1000)) {
      const [download] = await Promise.all([c.page.waitForEvent('download', { timeout: 15_000 }).catch(() => null), c.byTestId('shift-share').click()]);
      if (download) await download.saveAs(`${s.outDir}/money-share-card.png`);
      await c.page.waitForTimeout(600);
    }
    await scrollEnd(c);
    await c.shot('shift-summary-end', { settle: 300 });
    if (await has(c, 'shift-code', 1000)) {
      await c.byTestId('shift-code').click();
      await c.wait('handover-sheet');
      await c.shot('shift-summary-code', { settle: 900 });
      await c.page.keyboard.press('Escape');
      await c.page.waitForTimeout(400);
    }
    await c.byTestId('shift-close').click();
    await c.wait('home');
  } else {
    await c.shot('home-after-offline', { settle: 1200 });
  }

  // After handing in the cash: back under the cap, the done screen counts down home with "خليني هنا".
  if (await has(c, 'readiness', 8000)) {
    await s.demoPost('/demo/money/settle?who=courier');
    await doneJob(s, c);
    await c.shot('job-done-under-cap', { settle: 1600 });
    if (await has(c, 'done-stay', 2500)) await c.byTestId('done-stay').click();
  }

  // Earnings: the tab, then the latest job's receipt and the objection.
  await s.demoPost('/demo/clear?who=courier');
  await c.goto('/earnings');
  await c.wait('earnings-tab');
  await c.shot('tab-earnings', { settle: 1500 });
  const firstJob = c.page.locator('[data-testid^="job-line-"]').first();
  await firstJob.locator('[role="button"]').first().click();
  if (await has(c, 'receipt-head', 8000)) {
    await c.shot('receipt', { settle: 1200 });
    await scrollEnd(c);
    await c.shot('receipt-end', { settle: 300 });
    await c.byTestId('receipt-dispute').click();
    await c.wait('dispute-sheet');
    await c.byTestId('chip-low').click();
    await c.shot('receipt-dispute', { settle: 900 });
    await c.byTestId('dispute-send').click();
    await c.wait('dispute-sent');
    await c.shot('receipt-dispute-sent', { settle: 700 });
    await c.byTestId('dispute-done').click();
    await c.wait('receipt-query-open');
    await c.shot('receipt-query-open', { settle: 700 });
    // A job with a tip on top of the delivery fee and a cash split (the history seed).
    await c.goto('/earnings/statement?period=week');
    await c.wait('statement');
    await c.page.waitForTimeout(1200);
    const tipped = c.page.locator('[data-testid^="job-line-"]').filter({ hasText: 'إكرامية' }).first();
    if (await tipped.count()) {
      await tipped.locator('[role="button"]').first().click();
      await c.wait('receipt-head', 8000);
      await c.shot('receipt-tip', { settle: 1200 });
    }
  } else {
    await c.shot('earnings-job-open', { settle: 700 });
  }

  // Account → emergency contact.
  await c.goto('/account');
  await c.wait('account-tab');
  await c.shot('tab-account', { settle: 1200 });
  if (await has(c, 'hub-emergency', 3000)) {
    await c.byTestId('hub-emergency').click();
    await c.wait('emergency');
    await c.shot('emergency-empty', { settle: 900 });
    await c.page.locator('[data-testid="emergency-name"]').fill('أم علي');
    await c.byTestId('chip-mother').click();
    await c.page.locator('[data-testid="emergency-phone"]').fill('0771 234 5678');
    await c.shot('emergency-filled', { settle: 500 });
    await c.byTestId('emergency-save').click();
    await c.wait('account-tab');
    await c.shot('tab-account-with-contact', { settle: 900 });
    await c.byTestId('hub-emergency').click();
    await c.wait('emergency-current');
    await c.shot('emergency-saved', { settle: 700 });
  }
  await c.close();

  // A tuktuk ride: the fare, the platform's take as a rate, and all the cash to the company.
  const tk = await s.signIn('0770 111 0002');
  await tk.goto('/earnings');
  await tk.wait('earnings-tab');
  const ride = tk.page.locator('[data-testid^="job-line-"]').first();
  await ride.waitFor({ timeout: 10_000 }).catch(() => undefined);
  if (await ride.count()) {
    await ride.locator('[role="button"]').first().click();
    if (await has(tk, 'receipt-head', 8000)) await tk.shot('receipt-ride', { settle: 1200 });
  }
  await tk.close();
}
