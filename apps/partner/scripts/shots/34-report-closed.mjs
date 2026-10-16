// N20 «الشارع مسدود قدامي»: the courier's report from his job — the last row of the «مشكلة» sheet, the
// four-reason picker «ليش مسدود؟», and the thanks toast (unconfirmed: it waits for ops or a second courier).
//
//   SHOTS=report-closed node scripts/web-shots.mjs <out-dir>        (SHOTS_LOOK=night for the ember look)
export const name = 'report-closed';

const COURIER = '0770 111 0001';

export default async function run(s) {
  await s.demoPost('/demo/closure-clear');
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(COURIER);
  await s.demoPost('/demo/online?who=courier');
  await s.demoPost('/demo/job?who=courier&step=to_dropoff');
  await c.goto('/job');
  await c.wait('job-action');
  await c.byTestId('job-problem').click();
  await c.wait('job-problem-sheet');
  await c.wait('problem-closed');
  await c.shot('sheet', { settle: 900 });
  await c.byTestId('problem-closed').click();
  await c.wait('closed-reasons');
  await c.wait('closed-reason-works');
  await c.shot('picker', { settle: 900 });
  await c.byTestId('closed-reason-works').click();
  await c.page.getByText('شكراً، راح نتأكد منه').first().waitFor({ timeout: 10_000 });
  await c.shot('toast', { settle: 600 });
  await s.demoPost('/demo/closure-clear');
  await s.demoPost('/demo/clear?who=courier');
  await c.close();
}
