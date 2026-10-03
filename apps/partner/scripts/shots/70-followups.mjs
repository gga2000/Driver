// Follow-ups (2026-10-04): a fleet owner's invite from the driver's side (home banner, the card that
// says what the owner will see, accept), the owner's "بانتظار موافقة السايق" rows, a fleet member's
// card, and the courier's wallet top-up on the job (code → amount → confirm, counted on his cap).
export const name = 'followups';

export default async function run(s) {
  // ── fleet invite, driver side ──
  await s.demoPost('/demo/fleet/invite-reset');
  const d = await s.signIn('0770 111 0056');
  await d.wait('fleet-invite-banner');
  await d.shot('invite-home', { settle: 1500 });
  await d.byTestId('fleet-invite-banner').click();
  await d.wait('fleet-invite-sheet');
  await d.shot('invite-sheet', { settle: 900 });
  await d.goto('/account');
  await d.wait('fleet-invite-accept');
  await d.shot('invite-account', { full: true, settle: 900 });
  await d.byTestId('fleet-invite-accept').click();
  await d.wait('fleet-member-leave');
  await d.shot('invite-accepted', { settle: 900 });
  await d.close();
  await s.demoPost('/demo/fleet/invite-reset');

  // ── fleet owner: drivers who haven't said yes yet ──
  await s.demoPost('/demo/fleet/live');
  const o = await s.signIn('0770 111 0005');
  // The dashboard polls (and the map tiles never settle): load, don't wait for network idle.
  await o.page.goto(new URL('/fleet', o.page.url()).href, { waitUntil: 'load' });
  await o.wait('fleet-pending');
  await o.byTestId('fleet-pending').scrollIntoViewIfNeeded();
  await o.shot('fleet-pending', { settle: 900 });
  await o.page.goto(new URL('/fleet/add-driver', o.page.url()).href, { waitUntil: 'load' });
  await o.wait('fleet-add-driver-form');
  await o.shot('fleet-add-driver', { settle: 500 });
  await o.close();

  // ── a fleet member's account ──
  const m = await s.signIn('0770 111 0052');
  await m.goto('/account');
  await m.wait('fleet-member-leave');
  await m.shot('fleet-member', { settle: 700 });
  await m.close();

  // ── courier: the customer hands him cash for his wallet ──
  const t = await s.demoPost('/demo/topup?who=courier&step=at_dropoff&amount=25000');
  const c = await s.signIn('0770 111 0001');
  await c.goto('/job');
  await c.wait('job-topup-entry');
  await c.shot('job-topup-entry', { full: true, settle: 1500 });
  await c.byTestId('job-topup-entry').click();
  await c.wait('job-topup');
  await c.shot('topup-pad', { settle: 800 });
  for (const k of t.code) await c.byTestId(`ops-pad-${k}`).click();
  await c.wait('job-topup-found');
  await c.shot('topup-found', { full: true, settle: 900 });
  await c.byTestId('job-topup-confirm').click();
  await c.wait('job-topup-done');
  await c.shot('topup-done', { full: true, settle: 900 });
  await c.close();
}
