// Wave-1 core shots: welcome, the partner gate, home offline/online, offers (food, batch, ride),
// the job steps, unreachable, cash confirm and done, the intercity/khat home variants, the tabs.
export const name = 'core';

const PHONES = { courier: '0770 111 0001', tuktuk: '0770 111 0002', intercity: '0770 111 0003', khat: '0770 111 0004', customer: '0770 111 0009' };

export default async function run(s) {
  // Welcome (signed out).
  const guest = await s.openPage();
  await guest.goto('/');
  await guest.wait('welcome-start', 30_000);
  await guest.shot('welcome');
  // f4: sign-in in two plain steps, the number kept private; then the code.
  await guest.byTestId('welcome-start').click();
  await guest.wait('phone-input');
  // A number of its own: each number may ask for only so many codes a minute.
  await guest.page.locator('[data-testid="phone-input"]').fill('0770 111 0077');
  await guest.shot('signin-phone', { settle: 600 });
  await guest.byTestId('phone-submit').click();
  await guest.wait('otp-dev-strip');
  await guest.shot('signin-code', { settle: 600 });
  await guest.close();

  // A customer-only number lands on the gate.
  const customer = await s.signIn(PHONES.customer);
  await customer.wait('not-partner');
  await customer.shot('not-partner');
  await customer.close();

  // Courier: offline home → online (the switch) → offers → the job, step by step.
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(PHONES.courier);
  await c.wait('online-switch');
  await c.shot('home-offline', { settle: 1500 });
  // f4: before the phone asks for location "all the time", one screen says why, in his words.
  await c.goto('/location-why');
  await c.wait('location-why');
  await c.shot('location-why', { settle: 900 });
  await c.goto('/');
  await c.wait('online-switch');
  await c.byTestId('online-switch').click();
  await c.page.getByTestId('check-go').click({ timeout: 4000 }).catch(() => undefined);
  await c.page.getByText('شغّال · ندورلك طلب').waitFor({ timeout: 15_000 });
  await c.shot('home-online', { settle: 4500 });

  await s.demoPost('/demo/offer?who=courier&kind=food');
  await c.wait('offer', 10_000);
  await c.shot('offer', { settle: 1200 });
  await c.byTestId('offer-decline').click();
  await c.wait('home');

  await s.demoPost('/demo/offer?who=courier&kind=batch');
  await c.wait('offer-batch', 10_000);
  await c.shot('offer-batch', { settle: 1200 });
  await c.byTestId('offer-decline').click();
  await c.wait('home');
  await c.page.waitForTimeout(800);

  for (const step of ['to_pickup', 'at_pickup', 'to_dropoff']) {
    await s.demoPost(`/demo/job?who=courier&step=${step}`);
    await c.goto('/job');
    await c.wait('job-action');
    await c.shot(`job-${step.replace('_', '-')}`, { settle: 1500 });
    if (step === 'at_pickup') {
      // "استلمت الطلب" is a slide (P-08): the thumb half way across, then let go (it springs back).
      await c.slideHalf('job-action');
      await c.shot('job-at-pickup-sliding', { settle: 200 });
      await c.release();
    }
  }

  await s.demoPost('/demo/job?who=courier&step=at_dropoff');
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('job-at-dropoff', { settle: 1500 });
  await c.byTestId('job-action').click();
  await c.wait('handover-panel');
  await c.shot('job-cash', { settle: 900 });
  await c.slide('handover-confirm');
  await c.wait('job-done');
  await c.shot('job-done', { settle: 1200 });

  await s.demoPost('/demo/job?who=courier&step=unreachable');
  await c.goto('/job');
  await c.wait('unreachable-panel');
  await c.shot('job-unreachable', { settle: 2500 });

  await s.demoPost('/demo/clear?who=courier');
  await c.goto('/earnings');
  await c.wait('earnings-tab');
  await c.shot('tab-earnings');
  await c.goto('/account');
  await c.wait('account-tab');
  await c.shot('tab-account');
  await c.page.locator('[data-testid="appearance"]').scrollIntoViewIfNeeded();
  await c.shot('account-appearance', { settle: 600 });
  // n6: «حجم الخط» at its largest, then the job screen at that size; back to normal for later shots.
  await c.byTestId('text-size-largest').click();
  await c.page.locator('[data-testid="appearance"]').scrollIntoViewIfNeeded();
  await c.shot('account-text-largest', { settle: 800 });
  await s.demoPost('/demo/job?who=courier&step=to_dropoff');
  await c.goto('/job');
  await c.wait('job-action');
  await c.shot('job-text-largest', { settle: 1500 });
  await s.demoPost('/demo/clear?who=courier');
  await c.goto('/account');
  await c.wait('account-tab');
  await c.page.locator('[data-testid="appearance"]').scrollIntoViewIfNeeded();
  await c.byTestId('text-size-normal').click();
  await c.close();

  // Tuktuk: a ride broadcast reaches him in wave 1.
  const tk = await s.signIn(PHONES.tuktuk);
  await s.demoPost('/demo/online?who=tuktuk');
  await tk.reload();
  await tk.wait('home');
  await s.demoPost('/demo/offer?who=tuktuk&kind=ride');
  await tk.wait('offer', 10_000);
  await tk.shot('offer-ride', { settle: 1200 });
  await tk.byTestId('offer-decline').click();
  await tk.close();

  // Intercity and khat drivers: their home carries the garage board / today's run entry.
  for (const who of ['intercity', 'khat']) {
    const p = await s.signIn(PHONES[who]);
    await p.wait(`mode-${who}`);
    await p.shot(`home-${who}`, { settle: 1500 });
    await p.close();
  }
}
