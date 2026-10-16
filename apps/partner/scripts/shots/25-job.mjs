// The job (partner redesign step 3: j1–j10, d1–d4, r1, r5–r8, f7, b4–b6, b11): the step rail, the
// customer's words as the headline, the four actions over the main button, the big pickup code and
// its full screen, the kitchen's ready bar with the warning above the slide, the problem sheet, the
// safety shield and its dark alert sheet, the chat's step replies, the big change at the door, the
// done moment, and a tuktuk driver waiting for his rider.
//
//   SHOTS=job node scripts/web-shots.mjs <out-dir>
export const name = 'job';

const COURIER = '0770 111 0001';
const TUKTUK = '0770 111 0002';

export default async function run(s) {
  const c = await s.signIn(COURIER);

  // j1, j4, j9: on the way to the kitchen — the rail, the actions over «وصلت للمطعم», maps on the map.
  await s.demoPost('/demo/job?who=courier&step=to_pickup');
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('to-kitchen', { settle: 1500 });

  // j5, j6, b5: at the counter — the big code, the ready bar, the warning above the slide.
  await s.demoPost('/demo/job?who=courier&step=at_pickup');
  await c.goto('/job');
  await c.wait('job-pickup-code');
  await c.shot('at-kitchen', { settle: 1500 });
  await c.byTestId('job-pickup-code').click();
  await c.wait('job-code-full');
  await c.shot('code-full', { settle: 600 });
  await c.byTestId('job-code-close').click();
  await c.page.waitForTimeout(500);

  // j4 «مشكلة»: what can go wrong here, one tap each.
  await c.byTestId('job-problem').click();
  await c.wait('job-problem-sheet');
  await c.shot('problem', { settle: 700 });
  // r1: «سلامتك» opens the calm safety place.
  await c.byTestId('problem-safety').click();
  await c.wait('safety-sheet');
  await c.shot('safety', { settle: 900 });
  await c.page.keyboard.press('Escape');
  await c.page.waitForTimeout(600);

  // j2: on the way to the customer — the customer's own words lead, with the landmark.
  await s.demoPost('/demo/job?who=courier&step=to_dropoff&tender=25000&door=1');
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('to-door', { settle: 1500 });
  await c.shot('to-door-full', { full: true, settle: 300 });

  // r5 / b11: the chat's replies for this step, wrapped, none cut.
  await c.byTestId('job-chat').click();
  await c.wait('chat-quick-replies', 10_000).catch(() => undefined);
  await c.shot('chat-step-replies', { settle: 1200 });
  await c.goto('/job');
  await c.wait('job-action');

  // d1: the note handed over, the change big and green.
  await s.demoPost('/demo/job?who=courier&step=at_dropoff&tender=25000');
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('at-door', { settle: 1200 });
  await c.byTestId('job-action').click();
  await c.wait('handover-panel');
  const tender = c.byTestId('tender-chip-25000');
  if (await tender.count()) await tender.click();
  await c.shot('change', { settle: 700 });

  // d3, d4: «تسلم إيدك», the count-up, today; no cash card.
  await c.slide('handover-confirm');
  await c.wait('job-done');
  await c.shot('done', { settle: 1600 });
  await s.demoPost('/demo/clear?who=courier');
  await c.close();

  // r6: a tuktuk driver at the rider, the waiting clock running.
  const tk = await s.signIn(TUKTUK);
  await s.demoPost('/demo/offer?who=tuktuk&kind=ride');
  await tk.wait('offer', 15_000);
  await tk.hold('offer-accept');
  await tk.page.waitForTimeout(1200);
  await tk.goto('/job');
  await tk.wait('job-action');
  await tk.shot('ride-to-rider', { settle: 1500 });
  await tk.byTestId('job-action').click();
  await tk.wait('job-rider-wait', 10_000);
  await tk.page.waitForTimeout(3200);
  await tk.shot('ride-waiting', { settle: 400 });
  await s.demoPost('/demo/clear?who=tuktuk');
  await tk.close();
}
