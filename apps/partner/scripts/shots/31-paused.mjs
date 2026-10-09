// «حسابك موقّف مؤقتاً»: the screen behind the home banner when staff paused him after a safety report
// (online gate `staff_paused`, lane E #144). The demo pauses him for real (`/demo/account/pause`), so home
// shows the banner from the server's gate and the switch stays shut.
//
//   SHOTS=paused node scripts/web-shots.mjs <out-dir>
export const name = 'paused';

export default async function run(s) {
  await s.demoPost('/demo/account/pause?who=courier');
  const c = await s.signIn('0770 111 0001');
  await c.wait('gate-banner-paused');
  await c.shot('paused-home', { settle: 700 });
  await c.goto('/paused');
  await c.wait('paused');
  await c.shot('paused-screen', { settle: 700 });
  await c.close();
}
