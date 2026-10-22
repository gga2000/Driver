// «المدينة حيّة» (Ali, 2026-10-22: A + C, with a soft B): the courier's home is the live map. Before
// the shift (plain map, «اشتغل وتشوف…»), working (kitchens cooking and ready, «طلب جديد» ripples,
// driver counts on the second picture), «يومي» (today's deliveries with what each one earned), and no
// internet. Demo data: `scripts/demo/40-town.mjs`.
export const name = 'live';

const COURIER = '0770 111 0001';

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  const p = await s.signIn(COURIER);
  await p.wait('online-switch');
  await p.wait('driver-map-home');
  await p.shot('off-shift', { settle: 2500 });

  // Start the shift as he would: a tap on the slide, then «قبل ما تبدي».
  await p.byTestId('online-switch').click();
  const go = p.byTestId('check-go');
  if (await go.waitFor({ timeout: 5000 }).then(() => true, () => false)) await go.click();
  await p.page.getByText('شغّال · ندورلك طلب').waitFor({ timeout: 30_000 });
  await p.wait('live-town-layer');
  await p.shot('working', { settle: 1500 });
  // The next picture: the driver counts (one picture late) and a new ripple in الهاشمي.
  await s.demoPost('/demo/town/tick');
  await p.page.waitForTimeout(21_500);
  await p.shot('working-later', { settle: 1200 });

  await s.demoPost('/demo/town/day?who=courier');
  await p.byTestId('live-day-toggle').click();
  await p.wait('live-day-coin');
  await p.shot('my-day', { settle: 2600 });
  await p.byTestId('live-day-toggle').click();

  await p.context.setOffline(true);
  await p.page.waitForTimeout(2500);
  await p.shot('no-internet', { settle: 800 });
  await p.context.setOffline(false);
  await p.close();
}
