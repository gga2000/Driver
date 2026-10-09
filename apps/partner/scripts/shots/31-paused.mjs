// «حسابك موقّف مؤقتاً»: the screen behind the home banner when staff paused him after a safety report
// (online gate `staff_paused`, lane E). The screen needs nothing from the server.
//
//   SHOTS=paused node scripts/web-shots.mjs <out-dir>
export const name = 'paused';

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  await c.goto('/paused');
  await c.wait('paused');
  await c.shot('paused-screen', { settle: 700 });
  await c.close();
}
