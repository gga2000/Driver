// l4 «البروفة» (Ali chose A, 2026-10-08): the home card, the intro, then the real slip and job screens on
// a pretend order with the purple band and one tip per step, the door with the change, the done screen;
// a missed ring; the Account row; and a tuktuk driver's pretend ride. Nothing reaches the server.
//
//   SHOTS=practice node scripts/web-shots.mjs <out-dir>
export const name = 'practice';

/** A picture for the door photo (the file picker stands in for the camera on the web), when given. */
const PHOTO = process.env.SHOTS_PHOTO ?? null;

/** Waits for the band to show step n of 5 (each tap is answered on the phone, after the GPS read). */
async function step(p, n) {
  await p.page.waitForFunction((want) => document.querySelector('[data-testid="practice-step"]')?.textContent?.startsWith(String(want)), n, { timeout: 15_000 });
  await p.page.waitForTimeout(500);
}

export default async function run(s) {
  const c = await s.signIn('0770 111 0001');
  await c.wait('mode-practice');
  await c.shot('home-card', { settle: 900 });
  await c.byTestId('mode-practice').click();
  await c.wait('practice-intro');
  await c.shot('intro', { settle: 700 });

  // A missed ring: back to the intro, said kindly.
  await c.byTestId('practice-start').click();
  await c.wait('offer');
  await c.page.waitForTimeout(16_500);
  await c.wait('practice-missed');
  await c.shot('missed', { settle: 600 });

  // 1 · the slip rings
  await c.byTestId('practice-start').click();
  await c.wait('offer');
  await c.shot('1-slip', { settle: 1200 });
  await c.hold('offer-accept');
  // 2 · to the kitchen
  await c.wait('job-action');
  await c.shot('2-to-kitchen', { settle: 1500 });
  await c.byTestId('job-action').click();
  // 3 · at the counter: the code, then the slide
  await step(c, 3);
  await c.shot('3-at-kitchen', { settle: 1200 });
  await c.slide('job-action');
  // 4 · to the door
  await step(c, 4);
  await c.shot('4-to-door', { settle: 1200 });
  await c.byTestId('job-action').click();
  await step(c, 5);
  // 5 · at the door: the change helper and the photo
  await c.shot('5-at-door', { settle: 1000 });
  await c.byTestId('job-action').click();
  await c.wait('handover-panel');
  const tender = c.byTestId('tender-chip-20000');
  if (await tender.count()) await tender.click();
  if (PHOTO) {
    c.page.once('filechooser', (fc) => void fc.setFiles(PHOTO));
    await c.byTestId('handover-photo').click();
    await c.page.waitForTimeout(1500);
  }
  await c.shot('5-change', { settle: 700 });
  await c.shot('5-change-full', { full: true, settle: 300 });
  await c.slide('handover-confirm');
  await c.wait('practice-done', 15_000);
  await c.shot('done', { settle: 1200 });

  // Home again: the card has gone; Account keeps the row to run it again.
  await c.byTestId('practice-home').click();
  await c.wait('home');
  await c.shot('home-after', { settle: 900 });
  await c.goto('/account');
  await c.wait('hub-practice');
  await c.byTestId('hub-practice').scrollIntoViewIfNeeded();
  await c.shot('account-row', { settle: 700 });
  await c.close();

  // A tuktuk driver: a pretend ride.
  const tk = await s.signIn('0770 111 0002');
  await tk.goto('/practice');
  await tk.wait('practice-intro');
  await tk.shot('ride-intro', { settle: 700 });
  await tk.byTestId('practice-start').click();
  await tk.wait('offer');
  await tk.shot('ride-slip', { settle: 1200 });
  await tk.hold('offer-accept');
  await tk.wait('job-action');
  await tk.byTestId('job-action').click();
  await step(tk, 3);
  await tk.shot('ride-rider-in', { settle: 1000 });
  await tk.slide('job-action');
  await step(tk, 4);
  await tk.byTestId('job-action').click();
  await step(tk, 5);
  await tk.shot('ride-end', { settle: 1000 });
  await tk.slide('job-action');
  await tk.wait('practice-done', 15_000);
  await tk.shot('ride-done', { settle: 1200 });
  await tk.close();
}
