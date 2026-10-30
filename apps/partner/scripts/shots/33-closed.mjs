// N20 «شارع مسدود» on the courier's side: the job and the offer whose road goes around a street closed today
// (rust and cream stripes with a barrier at each end, «مسدود» on it, the road bent round it, one warning line),
// and the dash's map, which carries no road and so no closure (its busy-zone glow unchanged).
//
//   SHOTS=closed node scripts/web-shots.mjs <out-dir>        (SHOTS_LOOK=night for the ember look)
export const name = 'closed';

const COURIER = '0770 111 0001';
const NAME = encodeURIComponent('شارع المستشفى');

export default async function run(s) {
  await s.demoPost('/demo/closure-clear');
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(COURIER);

  // The dash: «وريني الخريطة», the busy zones glowing (no road, so nothing closed is drawn).
  await s.demoPost('/demo/online?who=courier');
  await c.goto('/');
  await c.wait('home');
  if (await c.byTestId('hint-map').isVisible().catch(() => false)) {
    await c.byTestId('hint-map').click();
    await c.wait('map-peek');
    await c.shot('dash', { settle: 2500 });
    await c.byTestId('map-peek-back').click();
  } else await c.shot('dash', { settle: 1500 });

  // The offer: the road to the kitchen goes around a named street, the line under both stops.
  await s.demoPost('/demo/offer?who=courier&kind=food');
  await s.demoPost(`/demo/closure?who=courier&on=offer&name=${NAME}`);
  await c.wait('offer', 10_000);
  await c.wait('offer-closed', 10_000);
  await c.shot('offer', { settle: 1800 });
  await c.byTestId('offer-decline').click();
  await c.wait('home');
  await s.demoPost('/demo/closure-clear');

  // The job, on the way to the customer: a nameless closure (the demo's straight-line roads add under a minute).
  await s.demoPost('/demo/job?who=courier&step=to_dropoff');
  await s.demoPost('/demo/closure?who=courier&on=job');
  await c.goto('/job');
  await c.wait('job-action');
  await c.wait('job-closed', 15_000);
  await c.shot('job', { settle: 2000 });
  // Who drew the stripes: MapLibre itself (web with WebGL) or the screen's fallback layer.
  const by = await c.page.evaluate(() => ({ maplibre: Boolean(document.querySelector('.maplibregl-canvas')), fallbackLines: Boolean(document.querySelector('[data-testid="closure-layer"] svg')), fallbackLabel: Boolean(document.querySelector('[data-testid="closure-label"]')) }));
  console.log(`closed streets drawn by: ${JSON.stringify(by)}`);
  await s.demoPost('/demo/closure-clear');
  await s.demoPost('/demo/clear?who=courier');
  await c.close();
}
