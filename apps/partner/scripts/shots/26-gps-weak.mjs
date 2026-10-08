// n7: on a job with a weak GPS (the browser gives a 300 m fix, worse than the 75 m the trail takes),
// the job screen says the customer's map has stopped moving, after 30 s.
export const name = 'gps';

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  await c.context.grantPermissions(['geolocation']);
  await c.context.setGeolocation({ latitude: 32.909, longitude: 45.064, accuracy: 300 });
  await s.demoPost('/demo/online?who=courier');
  await s.demoPost('/demo/job?who=courier&step=to_dropoff');
  await c.goto('/job');
  await c.wait('job-action');
  await c.wait('job-gps-weak', 50_000);
  await c.shot('job-gps-weak', { settle: 800 });
  await s.demoPost('/demo/clear?who=courier');
  await c.close();
}
