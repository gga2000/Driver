// Follow-ups (2026-10-04): the opening-hours editor (split shifts, past midnight, Friday prayer,
// holidays, a problem caught before saving, staff read-only, the board strip outside hours) and a
// staff invite still waiting (who it went to, resend, cancel). Seeded by scripts/demo/{hours,staff}.mjs.
const localDate = (offsetDays) =>
  new Date(Date.now() + 3 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

export default {
  name: 'followups',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    // The page scrolls inside its own view: grow the window to show a whole screen.
    const tall = async (name) => {
      const vp = page.viewportSize();
      await page.setViewportSize({ width: vp.width, height: 2300 });
      await shot(name, { wait: 900 });
      await page.setViewportSize(vp);
    };
    await demoPost('/demo/hours/reset');
    await demoPost('/demo/staff/reset');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-more' : 'nav-more').click();
    await byTestId('more-hours').click();
    await byTestId('hours-week').waitFor({ timeout: 15_000 });
    await tall('hours');

    // Sunday: lunch 12–3:30, then dinner 6 المغرب – 1 بالليل; same for the week; Friday dinner only.
    await byTestId('hours-shift-0-0').click();
    await byTestId('shift-sheet').waitFor();
    await byTestId('shift-hour-12').click();
    await byTestId('shift-side-end').click();
    await byTestId('shift-hour-15').click();
    await byTestId('shift-min-30').click();
    await shot('hours-shift', { wait: 500 });
    await byTestId('shift-done').click();
    await byTestId('hours-add-0').click();
    await byTestId('shift-sheet').waitFor();
    await byTestId('shift-hour-18').click();
    await byTestId('shift-min-00').click();
    await byTestId('shift-side-end').click();
    await byTestId('shift-hour-01').click();
    await byTestId('shift-min-00').click();
    await byTestId('shift-copy-all').click();
    await page.waitForTimeout(600);
    await byTestId('hours-shift-5-0').click();
    await byTestId('shift-remove').click();
    await page.waitForTimeout(400);

    // Eid: three days, a week or two from now.
    const from = localDate(16);
    const to = localDate(18);
    await byTestId('holiday-add').click();
    await byTestId('holiday-sheet').waitFor();
    if (from.slice(0, 7) !== localDate(0).slice(0, 7)) await byTestId('holiday-next').click();
    await byTestId(`holiday-day-${from}`).click();
    if (to.slice(0, 7) !== from.slice(0, 7)) await byTestId('holiday-next').click();
    await byTestId(`holiday-day-${to}`).click();
    await page.locator('[data-testid="holiday-note"]').fill('العيد');
    await shot('hours-holiday', { wait: 500 });
    await byTestId('holiday-confirm').click();
    await page.waitForTimeout(500);
    await tall('hours-edited');

    // A problem is caught before saving: Monday's lunch now runs into dinner.
    await byTestId('hours-shift-1-0').click();
    await byTestId('shift-sheet').waitFor();
    await byTestId('shift-side-end').click();
    await byTestId('shift-hour-20').click();
    await byTestId('shift-done').click();
    await byTestId('hours-problem').waitFor();
    await byTestId('hours-savebar').scrollIntoViewIfNeeded();
    await shot('hours-problem', { wait: 500 });
    await byTestId('hours-shift-1-0').click();
    await byTestId('shift-sheet').waitFor();
    await byTestId('shift-side-end').click();
    await byTestId('shift-hour-15').click();
    await byTestId('shift-min-30').click();
    await byTestId('shift-done').click();
    await byTestId('hours-save').click();
    await page.waitForTimeout(1200);
    await tall('hours-saved');

    // The board says so when customers can't order (outside the new hours, if it is right now).
    await h.goto('/');
    await byTestId('board').waitFor();
    await shot('board', { wait: 1200 });

    // A staff invite still waiting: who it went to, resend (once per 10 min), cancel.
    await byTestId(phone ? 'tab-more' : 'nav-more').click();
    await byTestId('more-staff').click();
    await byTestId('staff-pending').waitFor({ timeout: 15_000 });
    await tall('staff');
    await page.locator('[data-testid="staff-pending"] [data-testid^="staff-"]').first().click();
    await byTestId('member-sheet').waitFor();
    await shot('staff-invite', { wait: 500 });
    // The demo team was just (re)invited, so "resend" waits out its 10 minutes.
    await byTestId('member-remove').click();
    await byTestId('remove-sheet').waitFor();
    await shot('staff-cancel', { wait: 400 });
    await byTestId('remove-sheet-close').click();
    await demoPost('/demo/staff/reset');

    // Staff read the hours; only the owner edits.
    await signIn('0770 999 0000');
    await byTestId('stores').waitFor();
    await page.locator('[data-testid^="store-"]').filter({ hasText: 'خالد' }).first().click();
    await byTestId('board').waitFor({ timeout: 15_000 });
    await h.goto('/hours');
    await byTestId('hours-week').waitFor({ timeout: 15_000 });
    await tall('hours-staff');
    await demoPost('/demo/hours/reset');
  },
};
