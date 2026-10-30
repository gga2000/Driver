// M-3 «ينضاف لطلبك الجاي» on the courier's job: the customer owed a 500 دينار cancel fee, so the
// stop asks for the order plus the fee. The job card and the cash helper say why the amount is higher.
//
//   SHOTS=owed node scripts/web-shots.mjs <out-dir>
export const name = 'owed';

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  await s.demoPost('/demo/job?who=courier&step=at_dropoff&owed=500');
  await c.goto('/job');
  await c.wait('job-owed-fees');
  await c.shot('job', { settle: 1500 });
  await c.byTestId('job-action').click();
  await c.wait('cash-owed-split');
  await c.shot('cash', { settle: 800 });
  await c.close();
}
