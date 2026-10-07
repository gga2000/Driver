// Ride step 4. x1: on a hot day the taxi driver goes online and is asked «المكيّفة شغالة اليوم؟»; his
// «لا» leaves a quiet line with «رجعت تشتغل». x5: a tuktuk offer whose rider carries bags and a gas
// cylinder («عنده غراض: …»), then the same on the trip. Personas from scripts/demo/98-souq.mjs.
export const name = 'souq';

const TAXI = '0770 111 0017';
const TUKTUK = '0770 111 0002';

export default async function run(s) {
  await s.demoPost('/demo/weather?at=hot');
  const taxi = await s.signIn(TAXI);
  await taxi.wait('home');
  await taxi.byTestId('online-switch').click();
  await taxi.wait('climate-check', 15_000);
  await taxi.shot('ac-question', { settle: 1200 });
  await taxi.byTestId('climate-no').click();
  await taxi.wait('climate-off', 10_000);
  await taxi.shot('ac-off', { settle: 1500 });
  await s.demoPost('/demo/weather?at=real');
  await taxi.close();

  const tk = await s.signIn(TUKTUK);
  await s.demoPost('/demo/online?who=tuktuk');
  await tk.reload();
  await tk.wait('home');
  await s.demoPost('/demo/souq-offer?who=tuktuk');
  await tk.wait('offer-cargo', 15_000);
  await tk.shot('offer-cargo', { settle: 1200 });
  await tk.byTestId('offer-decline').click();
  await s.demoPost('/demo/souq-job?who=tuktuk');
  await tk.goto('/job');
  await tk.wait('job-cargo', 15_000);
  await tk.shot('job-cargo', { full: true, settle: 1200 });
  await s.demoPost('/demo/clear?who=tuktuk');
  await tk.close();
}
