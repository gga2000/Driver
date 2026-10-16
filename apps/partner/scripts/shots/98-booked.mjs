// Review #28: «مشاوير باچر» for the tuktuk driver — rides the buyer booked for tomorrow, offered the
// evening before (POST /demo/booked opens the evening now). First the open ones (one asking for him by
// name, «الزبون طلبك إنت»), then with one he took («مشاويري المحجوزة» and «ما أگدر أجي»), its home card
// and the drop-it question.
export const name = 'booked';

const TUKTUK = '0770 111 0002';

export default async function run(s) {
  const tk = await s.signIn(TUKTUK);
  await s.demoPost('/demo/online?who=tuktuk');
  await s.demoPost('/demo/booked?who=tuktuk');
  await tk.reload();
  await tk.wait('home');
  await tk.wait('mode-booked', 15_000);
  await tk.shot('home-open');
  await tk.goto('/booked');
  await tk.wait('booked-open', 15_000);
  await tk.shot('open', { settle: 900 });

  await s.demoPost('/demo/booked?who=tuktuk&mine=1');
  await tk.goto('/');
  await tk.wait('mode-booked', 15_000);
  await tk.shot('home-mine');
  await tk.goto('/booked');
  await tk.wait('booked-mine', 15_000);
  await tk.shot('mine', { settle: 900 });
  await tk.shot('mine-full', { full: true });
  await tk.byTestId('booked-release').click();
  await tk.wait('booked-release-yes', 10_000);
  await tk.shot('release-sheet', { settle: 700 });
  await tk.close();
}
