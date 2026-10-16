// Taxi idea x3 (seat hold), driver side: a rider our late taxi is bringing — the line on his seat in
// garage mode and in his sheet. The hold is off (RIDE_SEAT_HOLD), so it informs without holding.
export const name = 'taxihold';

export default async function run(s) {
  const seed = await s.demoPost('/demo/intercity/seed?who=intercity');
  await s.demoPost(`/demo/intercity/taxi-late?bookingId=${encodeURIComponent(seed.bookings.ahmed)}&min=6`);
  const p = await s.signIn('0770 111 0003');
  await p.goto(`/intercity/departure/${seed.runA}`);
  await p.wait('garage-seatmap');
  await p.page.getByText('تكسينا ').first().waitFor({ timeout: 15_000 });
  await p.shot('taxi-late-seat', { settle: 1200 });
  await p.byTestId('gseat-rear_right').click();
  await p.wait('rider-taxi-late');
  await p.shot('taxi-late-sheet', { settle: 600 });
}
