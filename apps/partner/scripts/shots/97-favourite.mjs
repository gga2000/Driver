// Joy l9: a rider kept this tuktuk driver as a favourite and booked a ride for later asking for him —
// when its search starts the offer rings for him alone for a minute, saying «الزبون طلبك إنت».
export const name = 'favourite';

const TUKTUK = '0770 111 0002';

export default async function run(s) {
  const tk = await s.signIn(TUKTUK);
  await s.demoPost('/demo/online?who=tuktuk');
  await tk.reload();
  await tk.wait('home');
  await s.demoPost('/demo/offer?who=tuktuk&kind=favourite');
  await tk.wait('offer-favourite', 15_000);
  await tk.shot('offer', { settle: 1200 });
  await tk.byTestId('offer-decline').click();
  await tk.close();
}
