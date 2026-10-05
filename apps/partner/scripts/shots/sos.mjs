// SOS shots (scoring & safety §3): the طوارئ button on every active trip — a food job, a tuktuk
// ride, a الرجعة departure, a private ride and a خطوط run — then the 3-second hold in progress and
// the confirmation sheet with its 10-second "كنسل — تنبيه بالغلط".
//
//   SHOTS=sos node scripts/web-shots.mjs <out-dir>
//
// Works against a build without the button too (the "before" set): hold shots are skipped.
export const name = 'sos';

/** Presses the SOS button and keeps it held for `ms` (pointer events, like a thumb). */
async function hold(p, ms) {
  const box = await p.byTestId('sos-button').boundingBox();
  if (!box) throw new Error('sos-button has no box');
  await p.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.page.mouse.down();
  await p.page.waitForTimeout(ms);
}

async function has(p, id) {
  return p.byTestId(id).isVisible().catch(() => false);
}

/** A phone with GPS (the browser shares a fix) and, for the courier, an emergency contact on file. */
async function withGps(p, s, contact) {
  await p.context.grantPermissions(['geolocation']);
  await p.context.setGeolocation({ latitude: 32.9061, longitude: 45.0652, accuracy: 8 });
  if (!contact) return;
  const token = await p.page.evaluate(() => JSON.parse(localStorage.getItem('driver.partner.session') ?? '{}').accessToken ?? null);
  if (!token) return;
  await fetch(`${s.apiBase}/trpc/identity.updateProfile`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ json: { emergencyContact: contact } }),
  });
}

export default async function run(s) {
  // Food courier on his way to the kitchen.
  await s.demoPost('/demo/job?who=courier&step=to_pickup');
  const c = await s.signIn('0770 111 0001');
  await withGps(c, s, { name: 'أم حيدر', phone: '07809990001' });
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('job', { settle: 1500 });

  if (await has(c, 'sos-button')) {
    // The hold, half way: the ring fills in the danger colour, the label counts down.
    await hold(c, 1600);
    await c.shot('hold', { settle: 0 });
    // Let go early: nothing is sent.
    await c.page.mouse.up();
    await c.page.waitForTimeout(600);
    await c.shot('hold-released', { settle: 200 });
    // A full hold: the alert goes out and the sheet opens with its 10-second cancel.
    await hold(c, 3400);
    await c.page.mouse.up();
    await c.wait('sos-sheet', 10_000);
    await c.shot('sent', { settle: 900 });
    await c.byTestId('sos-cancel').click();
    await c.page.getByText('لغينا التنبيه', { exact: false }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await c.shot('cancelled', { settle: 600 });
    await c.byTestId('sos-close').click();
    await c.page.waitForTimeout(600);
    // A second, real alert: after the 10 s the emergency contact has the link; the button stays lit.
    await hold(c, 3400);
    await c.page.mouse.up();
    await c.wait('sos-sheet', 10_000);
    await c.page.waitForTimeout(16_000);
    await c.shot('sent-after-window', { settle: 400 });
    await c.byTestId('sos-close').click();
    await c.page.waitForTimeout(600);
    await c.shot('job-alert-open', { settle: 400 });
  }
  await c.close();

  // Tuktuk ride: accept the broadcast, then the job screen.
  const tk = await s.signIn('0770 111 0002');
  await s.demoPost('/demo/offer?who=tuktuk&kind=ride');
  await tk.wait('offer', 15_000);
  await tk.byTestId('offer-accept').click();
  await tk.page.waitForTimeout(1200);
  await tk.goto('/job');
  await tk.wait('job-action');
  await tk.shot('ride', { settle: 1500 });
  await tk.close();

  // الرجعة: the boarding departure and the private ride from the request board.
  const seed = await s.demoPost('/demo/intercity/seed?who=intercity');
  const ic = await s.signIn('0770 111 0003');
  await withGps(ic, s, null);
  await ic.goto(`/intercity/departure/${seed.runA}`);
  await ic.wait('driver-seatmap');
  await ic.page.getByText('زهراء').first().waitFor({ timeout: 15_000 });
  await ic.shot('departure', { settle: 1500 });
  await ic.goto(`/intercity/request/${seed.rideId}`);
  await ic.wait('request-ride');
  await ic.shot('private-ride', { settle: 1200 });
  await ic.close();

  // خطوط: today's run.
  await s.demoPost('/demo/khat/seed?who=khat');
  const k = await s.signIn('0770 111 0004');
  await k.goto('/khat');
  await k.wait('khat-run');
  await k.wait('khat-place-0');
  await k.shot('khat', { settle: 1500 });
  await k.close();
}
