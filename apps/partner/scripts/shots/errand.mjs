// «دوّرلي»: the courier's job with the customer's list «الليستة» (photo, voice note, «إذا ماكو», price
// ceilings), then two items ticked. Demo: scripts/demo/errand.mjs. SHOTS_LOOK=night for the ember look.
export const name = 'errand';

const COURIER = '0770 111 0001';

export default async function run(s) {
  await s.demoPost('/demo/errand-job?who=courier');
  const c = await s.signIn(COURIER);
  await c.goto('/job');
  await c.wait('errand-list');
  await c.shot('rail', { settle: 1500 });
  await c.byTestId('errand-list').scrollIntoViewIfNeeded();
  await c.shot('list', { settle: 1500 });
  await c.byTestId('errand-tick-2').click();
  await c.byTestId('errand-tick-3').click();
  await c.shot('ticked', { settle: 600 });
  await c.reload();
  await c.wait('errand-list');
  await c.byTestId('errand-list').scrollIntoViewIfNeeded();
  await c.shot('ticked-after-reload', { settle: 1200 });

  // At the shops: the receipt panel under the list; a total over the customer's limit asks him to call first.
  await s.demoPost('/demo/errand-job?who=courier&step=at_shops');
  await c.goto('/job');
  await c.byTestId('errand-receipt').waitFor({ state: 'attached', timeout: 15_000 });
  await c.byTestId('errand-receipt').scrollIntoViewIfNeeded();
  await c.shot('receipt', { settle: 1200 });
  await c.byTestId('errand-receipt-amount').fill('31000');
  await c.byTestId('errand-receipt').scrollIntoViewIfNeeded();
  await c.shot('receipt-over', { settle: 600 });
}
