// CORE-05 «حدّث التطبيق»: an old store build the server refuses. The demo web build stands in for
// store build 0.9.0 (DEV_TOOLS only, `src/lib/app-build.ts`); the demo API must be started with
// MIN_APP_VERSIONS=partner:1.0.0. The page says he can't take offers until he updates.
//
//   MIN_APP_VERSIONS=partner:1.0.0 node scripts/demo-api.mjs
//   SHOTS=update node scripts/web-shots.mjs <out-dir>
export const name = 'update';

const KEY = 'driver.partner.demo-build';

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  await s.demoPost('/demo/online?who=courier');
  // Signed in on a current build first, online, then the same phone on a refused build.
  const c = await s.signIn('0770 111 0001');
  await c.goto('/');
  await c.wait('online-switch');
  await c.page.waitForTimeout(1500);
  await c.page.evaluate(([k]) => localStorage.setItem(k, '0.9.0'), [KEY]);
  await c.reload();
  await c.wait('update-required', 15_000);
  await c.shot('update-required', { settle: 900 });
  await c.close();
}
