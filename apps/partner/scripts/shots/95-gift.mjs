// «عزيمة» (joy g1): a gift job whose sender paid from his wallet and hid the prices — the pickup asks
// the kitchen to keep the receipt out of the bag, the drop-off says «هدية · لا تذكر السعر».
export const name = 'gift';

const COURIER = '0770 111 0001';

export default async function run(s) {
  const c = await s.signIn(COURIER);
  await s.demoPost('/demo/job?who=courier&step=to_pickup&gift=1');
  await c.goto('/job');
  await c.wait('job-gift');
  await c.shot('job-pickup', { settle: 1500 });
  await s.demoPost('/demo/job?who=courier&step=to_dropoff&gift=1');
  await c.goto('/job');
  await c.wait('job-gift');
  await c.shot('job-dropoff', { settle: 1500 });
}
