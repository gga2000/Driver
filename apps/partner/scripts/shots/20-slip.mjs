// The order slip (partner redesign o1–o15): the service colours, the money with its parts, a tap too
// short to accept, a second order on the way, a tuktuk ride held to accept, and the greyed call (G0-10).
export const name = 'slip';

const PHONES = { courier: '0770 111 0001', tuktuk: '0770 111 0002' };

async function online(p) {
  await p.wait('online-switch');
  await p.byTestId('online-switch').click();
  await p.page.getByTestId('check-go').click({ timeout: 4000 }).catch(() => undefined);
  await p.page.getByText('شغّال · ندورلك طلب').waitFor({ timeout: 15_000 });
}

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(PHONES.courier);
  await online(c);

  // o1 food saffron, o2 money with chips, o8 cash chip, o9 kitchen time, o7 landmarks.
  await s.demoPost('/demo/offer?who=courier&kind=food');
  await c.wait('offer', 10_000);
  await c.shot('food', { settle: 1500 });

  // o3: a quick tap doesn't accept; it says to hold.
  await c.byTestId('offer-accept').click();
  await c.shot('hold-hint', { settle: 300 });
  await c.byTestId('offer-decline').click();
  await c.wait('home');

  // o13: a second order on the way, with the minutes it adds.
  await s.demoPost('/demo/offer?who=courier&kind=batch');
  await c.wait('offer-batch', 10_000);
  await c.shot('batch', { settle: 1500 });
  await c.byTestId('offer-decline').click();
  await c.wait('home');

  // G0-10: on the job the call is greyed «قريباً» and offers the chat.
  await s.demoPost('/demo/job?who=courier&step=to_dropoff');
  await c.goto('/job');
  await c.wait('job-call');
  await c.shot('job-call-soon', { settle: 1500 });
  await c.close();

  // b9 / o1: a tuktuk ride is plum; o10 fixed fare and the rider's rides; o3 held to accept.
  await s.demoPost('/demo/clear?who=tuktuk');
  const k = await s.signIn(PHONES.tuktuk);
  await online(k);
  await s.demoPost('/demo/offer?who=tuktuk&kind=ride');
  await k.wait('offer', 10_000);
  await k.shot('tuktuk', { settle: 1500 });
  await k.hold('offer-accept');
  await k.wait('job-action', 15_000);
  await k.shot('accepted', { settle: 1200 });
}
