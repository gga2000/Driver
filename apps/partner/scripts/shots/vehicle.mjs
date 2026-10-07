// Ride step 3 (d1, n1, n2): «مميزات سيارتك» and the car's model and colour. Tuktuk: «ممنوع التدخين»
// confirmed, «عوائل» waiting, AC/heating not offered; الرجعة car: «الحر والبرد» with AC confirmed and
// heating waiting, then a new tick before saving; the account row; the fleet owner's new-vehicle form
// with a model and a colour picked. Personas from scripts/demo/10-core-people.mjs and fleet.mjs.
export const name = 'vehicle';

const PHONES = { tuktuk: '0770 111 0002', car: '0770 111 0003', fleet: '0770 111 0005' };

export default async function run(s) {
  const tk = await s.signIn(PHONES.tuktuk);
  await tk.goto('/account');
  await tk.wait('hub-vehicle-features');
  await tk.shot('account-row', { settle: 900 });
  await tk.byTestId('hub-vehicle-features').click();
  await tk.wait('features-car');
  await tk.shot('tuktuk', { full: true, settle: 900 });

  const car = await s.signIn(PHONES.car);
  await car.goto('/vehicle');
  await car.wait('features-car');
  await car.shot('car', { full: true, settle: 900 });
  await car.byTestId('feature-big_boot').click();
  await car.shot('car-ticked', { full: true, settle: 500 });

  const owner = await s.signIn(PHONES.fleet);
  await owner.goto('/fleet/add-vehicle');
  await owner.wait('fleet-add-vehicle-form');
  await owner.byTestId('fleet-plate-input').fill('واسط 77120');
  await owner.byTestId('fleet-model-input').fill('كيا سيراتو');
  await owner.byTestId('colour-maroon').click();
  await owner.shot('add-vehicle', { full: true, settle: 600 });
}
