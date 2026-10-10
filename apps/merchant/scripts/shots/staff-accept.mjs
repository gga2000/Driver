// PRV-08: a staff invite waits for the invitee. A person with no store sees it on the "not activated"
// screen; staff at another store see it above their store list.
export default {
  name: 'staff-accept',
  viewports: ['tablet', 'phone'],
  async run(h) {
    const { page, byTestId, shot, signIn } = h;
    await signIn('0770 444 0000');
    await page.locator('[data-testid^="invite-"]').first().waitFor({ timeout: 15_000 });
    await shot('invite-new-person', { wait: 900 });
    await signIn('0770 999 0000');
    await byTestId('stores').waitFor();
    await page.locator('[data-testid^="invite-"]').first().waitFor({ timeout: 15_000 });
    await shot('invite-stores', { wait: 900 });
  },
};
