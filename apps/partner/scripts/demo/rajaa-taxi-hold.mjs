// Taxi idea x3 (seat hold), driver side: put our late taxi on one seat of the intercity persona's
// run A, as the garage-taxi tick would (`DeparturesService.taxiLate`). The hold itself is off
// (RIDE_SEAT_HOLD), so garage mode shows «جاي بتكسينا · يوصل …» and the driver may still leave.
//
//   POST /demo/intercity/taxi-late?bookingId=…&min=6   → { bookingId, until }
export default async function register(demo) {
  const routes = await demo.load('modules/routes/index.js');
  const departures = demo.app.get(routes.DeparturesService);
  demo.route('/demo/intercity/taxi-late', async ({ res, query }) => {
    const b = await departures.booking(String(query.bookingId));
    const until = new Date(Date.now() + Number(query.min ?? 6) * 60_000);
    await departures.taxiLate(b.riderId, b.id, until);
    demo.json(res, 200, { bookingId: b.id, until });
  });
}
