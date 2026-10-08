// Wave-2 fleet owner shots: the dashboard (week chart, online count, documents, drivers), a day on
// the chart, a driver's earnings, vehicles, assigning a driver, adding a vehicle and a driver.
export const name = 'fleet';

const OWNER = '0770 111 0005';

export default async function run(s) {
  const info = await (await fetch(`${s.apiBase}/demo/fleet/info`)).json();
  const p = await s.signIn(OWNER);

  await s.demoPost('/demo/fleet/live');
  await p.goto('/fleet');
  await p.wait('fleet-overview');
  await p.shot('overview', { full: true, settle: 1200 });
  await p.shot('overview-top', { settle: 300 });

  // Tap Thursday on the chart: the caption names that day's amount.
  await p.byTestId('fleet-bar-4').click();
  await p.shot('chart-day', { settle: 400 });

  await s.demoPost('/demo/fleet/live');
  await p.byTestId(`fleet-driver-${info.drivers.f_mustafa}`).click();
  await p.wait('fleet-driver-earnings');
  await p.shot('driver', { full: true, settle: 1000 });

  await p.goto('/fleet/vehicles');
  await p.wait('fleet-vehicles');
  await p.shot('vehicles', { full: true, settle: 900 });

  const van = info.vehicles.find((v) => v.vehicleClass === 'van');
  await p.byTestId(`fleet-assign-${van.vehicleId}`).click();
  await p.wait('fleet-assign');
  await p.byTestId(`fleet-pick-${info.drivers.f_ali}`).click();
  await p.shot('assign', { settle: 600 });

  await p.goto('/fleet/add-vehicle');
  await p.wait('fleet-add-vehicle-form');
  await p.byTestId('fleet-class-van').click();
  await p.page.locator('[data-testid="fleet-plate-input"]').fill('واسط 70455');
  await p.page.locator('[data-testid="fleet-model-input"]').fill('هيونداي H1');
  await p.byTestId('colour-white').click();
  await p.shot('add-vehicle', { settle: 500 });
  await p.byTestId('fleet-save-vehicle').click();
  // Saved (a van needs its model and colour, so both are filled above): the toast names the plate.
  await p.page.getByText('انضافت واسط 70455 لأسطولك').first().waitFor({ timeout: 10_000 });

  // f5: one screen, the number and the car (the new van is free; the green tuktuk waits on حيدر's invite).
  await p.goto('/fleet/add-driver');
  await p.wait('fleet-add-driver-form');
  await p.page.locator('[data-testid="fleet-driver-phone"]').fill('07801234567');
  await p.wait('fleet-add-driver-car');
  // The new van is the one free car, so it is already picked.
  await p.page.getByText('واسط 70455').first().waitFor();
  await p.shot('add-driver', { settle: 800 });
  await p.shot('add-driver-full', { full: true, settle: 300 });
  await p.byTestId('fleet-add-driver-save').click();
  await p.wait('fleet-pending');
  await p.byTestId('fleet-pending').scrollIntoViewIfNeeded();
  await p.shot('add-driver-pending', { settle: 900 });
  await p.close();
}
