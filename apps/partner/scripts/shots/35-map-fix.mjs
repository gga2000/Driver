// «الخريطة غلط» (Ali's pick C, 2026-10-22): the row in the job's «مشكلة» sheet, the sheet for the
// kitchen of this stop, and the after-pickup question «"X" جان هنا؟» when he took the bag ~70 m from
// the kitchen's pin.
//
//   SHOTS=map-fix node scripts/web-shots.mjs <out-dir>
export const name = 'map-fix';

const COURIER = '0770 111 0001';
/** مطعم خالد's pin in the demo, and a spot ~70 m north of it. */
const KHALID = { latitude: 32.9095, longitude: 45.0635 };
const NORTH = { latitude: 32.91013, longitude: 45.0635, accuracy: 8 };

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(COURIER);
  await c.context.grantPermissions(['geolocation']);
  await c.context.setGeolocation({ ...KHALID, accuracy: 8 });
  await s.demoPost('/demo/online?who=courier');
  await s.demoPost('/demo/job?who=courier&step=at_pickup');
  await c.goto('/job');
  await c.wait('job-action');
  await c.byTestId('job-problem').click();
  await c.wait('problem-mapfix');
  await c.shot('menu', { settle: 900 });
  await c.byTestId('problem-mapfix').click();
  await c.wait('mapfix-sheet');
  await c.wait('mapfix-send');
  await c.shot('sheet', { settle: 900 });
  await c.page.getByText('اسمه غلط').first().click();
  await c.wait('mapfix-name');
  await c.shot('sheet-name', { settle: 600 });
  await c.page.getByText('مكانه مو هنا').first().click();
  await c.byTestId('mapfix-send').click();
  await c.page.getByText('شكراً، الفريق يشوفه ويصلّحه.').first().waitFor({ timeout: 10_000 });
  await c.shot('thanks', { settle: 500 });

  // After the pickup: the bag is ready, he takes it standing ~70 m from the pin.
  await s.demoPost('/demo/job?who=courier&step=ready');
  await c.page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.includes('mapfix.asked')) localStorage.removeItem(k);
  });
  await c.context.setGeolocation(NORTH);
  await c.goto('/job');
  await c.wait('job-action');
  await c.slide('job-action');
  await c.wait('mapfix-ask', 12_000);
  await c.shot('ask', { settle: 900 });
  await c.byTestId('mapfix-ask-no').click();
  await s.demoPost('/demo/clear?who=courier');
  await c.close();
}
