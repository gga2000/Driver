// The offer ring counts from the server's clock (a phone 30 s fast still gets the whole ring), and the
// card comes back on top when back takes it off while the offer is unanswered.
export const name = 'slip-clock';

const COURIER = '0770 111 0001';
const PHONE_FAST_MS = 30_000;

export default async function run(s) {
  await s.demoPost('/demo/clear?who=courier');
  const c = await s.signIn(COURIER);
  // From here on this phone's clock runs 30 s fast.
  await c.context.addInitScript((ms) => {
    const real = Date.now;
    Date.now = () => real() + ms;
  }, PHONE_FAST_MS);
  await c.reload();
  await c.wait('online-switch');
  await c.byTestId('online-switch').click();
  await c.page.getByTestId('check-go').click({ timeout: 4000 }).catch(() => undefined);
  await c.page.getByText('شغّال · ندورلك طلب').waitFor({ timeout: 15_000 });

  await s.demoPost('/demo/offer?who=courier&kind=food');
  await c.wait('offer', 10_000);
  await c.shot('fast-phone', { settle: 1200 });

  // Back while it is unanswered: the card comes straight back.
  await c.page.goBack();
  await c.wait('offer', 10_000);
  await c.shot('after-back', { settle: 800 });
  await c.byTestId('offer-decline').click();
  await c.wait('home');
  await c.shot('declined-stays-home', { settle: 2500 });
}
