// Ride ideas c9/s3: a tuktuk ride booked for «أم علي» — the offer names her, the job calls her.
export const name = 'ridefor';

export default async function run(s) {
  const tk = await s.signIn('0770 111 0002');
  await s.demoPost('/demo/online?who=tuktuk');
  await tk.reload(); await tk.wait('home');
  await s.demoPost('/demo/offer?who=tuktuk&kind=ride&for=1');
  await tk.wait('offer-rider', 15_000);
  await tk.shot('offer', { settle: 1200 });
  await tk.byTestId('offer-accept').click();
  await tk.page.waitForTimeout(1200);
  await tk.goto('/job');
  await tk.wait('job-rider');
  await tk.shot('job', { settle: 1500 });
  await tk.close();
}
