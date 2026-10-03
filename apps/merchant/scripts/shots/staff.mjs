// Wave 2 staff shots: the team with roles, invites waiting, add by phone with the role picker, change
// a role, remove with a confirm step; and the owner-only gate a staff member sees. Seeded by
// scripts/demo/staff.mjs (reset before and after).
export default {
  name: 'staff',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, demoPost, signIn, viewport } = h;
    const phone = viewport === 'phone';
    await demoPost('/demo/staff/reset');
    await signIn('0770 123 4567');
    await byTestId('board').waitFor();
    await byTestId(phone ? 'tab-more' : 'nav-more').click();
    await byTestId('more-staff').click();
    await byTestId('staff-team').waitFor({ timeout: 15_000 });
    await shot('staff', { wait: 900 });

    // ضيف موظف: number + role.
    await byTestId('staff-invite').click();
    await byTestId('invite-sheet').waitFor();
    await page.locator('[data-testid="invite-phone"]').fill('07812345678');
    await byTestId('role-merchant_staff').click();
    await shot('invite');
    await byTestId('invite-confirm').click();
    await page.waitForTimeout(1200);
    await shot('invited', { wait: 900 });

    // A team member: change role, then the remove confirm.
    await page.waitForTimeout(3500); // let the "added" toast go
    const row = page.locator('[data-testid^="staff-"]:not([data-testid="staff-team"]):not([data-testid="staff-pending"]):not([data-testid="staff-invite"])').filter({ hasText: 'زينب' }).first();
    await row.click();
    await byTestId('member-sheet').waitFor();
    await byTestId('role-merchant_owner').click();
    await shot('member');
    await byTestId('member-remove').click();
    await byTestId('remove-sheet').waitFor();
    await shot('remove');
    await byTestId('remove-sheet-close').click();
    await demoPost('/demo/staff/reset');

    // A staff member who opens /money directly.
    await signIn('0770 999 0000');
    await byTestId('stores').waitFor();
    await page.locator('[data-testid^="store-"]').first().click();
    await byTestId('board').waitFor({ timeout: 15_000 });
    await h.goto('/money');
    await byTestId('money').waitFor();
    await shot('staff-gate', { wait: 900 });
  },
};
