// Partner redesign r4 «هيج يشوفك الزبون»: the page a rider opens on his photo, from the account tab,
// for the الرجعة car driver (car with confirmed AC) and the tuktuk driver.
//
//   SHOTS=seen node scripts/web-shots.mjs <out-dir>
export const name = 'seen';

export default async function run(s) {
  const car = await s.signIn('0770 111 0003');
  await car.goto('/account');
  await car.wait('hub-seen');
  await car.shot('account-row', { settle: 900 });
  await car.byTestId('hub-seen').click();
  await car.wait('seen-sheet', 15_000);
  await car.shot('car', { settle: 1200 });
  await car.shot('car-full', { full: true, settle: 300 });
  await car.close();

  const tk = await s.signIn('0770 111 0002');
  await tk.goto('/seen');
  await tk.wait('seen-sheet', 15_000);
  await tk.shot('tuktuk-full', { full: true, settle: 1200 });
  await tk.close();
}
