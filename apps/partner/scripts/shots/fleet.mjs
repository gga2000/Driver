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
  await p.shot('add-vehicle', { settle: 500 });
  await p.byTestId('fleet-save-vehicle').click();
  await p.page.waitForTimeout(1200);

  await p.goto('/fleet/add-driver');
  await p.wait('fleet-add-driver-form');
  await p.page.locator('[data-testid="fleet-driver-phone"]').fill('07801234567');
  await p.shot('add-driver', { settle: 500 });
  await p.close();
}
