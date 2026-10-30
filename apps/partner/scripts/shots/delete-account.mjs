// «احذف حسابي» (docs/api/account-close.md): the row at the end of الحساب › help, the screen that says
// what goes and what stays, and the answer once the request is in (a support case).
//
//   SHOTS=delete-account node scripts/web-shots.mjs <out-dir>
export const name = 'delete-account';

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  await c.goto('/account');
  await c.wait('hub-delete-account');
  await c.page.locator('[data-testid="hub-delete-account"]').scrollIntoViewIfNeeded();
  await c.shot('row', { settle: 700 });
  await c.goto('/delete-account');
  await c.wait('delete-account');
  await c.shot('screen', { full: true, settle: 700 });
  await c.byTestId('delete-account-send').click();
  await c.wait('delete-account-sent');
  await c.shot('sent', { settle: 700 });
  await c.close();
}
