// HUNT-02 «بالشارع» on the courier's job: the customer chose to come out to the street (he paid less),
// so the drop-off says it plainly and the courier calls instead of walking to the door.
//
//   SHOTS=street node scripts/web-shots.mjs <out-dir>
export const name = 'street';

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  await s.demoPost('/demo/job?who=courier&step=to_dropoff&street=1&tender=20000');
  await c.goto('/job');
  await c.wait('job-street');
  await c.shot('to-street', { settle: 1500 });
  await c.shot('to-street-full', { full: true, settle: 300 });
  await c.close();
}
