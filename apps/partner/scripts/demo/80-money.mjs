// Money moments (UI/UX audit S-3 end of job, S-4 end of shift, S-7 pay receipt):
//
//   POST /demo/money/shift?who=courier&hours=5   puts him online with a shift that started `hours` ago
//                                                (hold the switch to see the end-of-shift summary)
//   POST /demo/money/settle?who=courier          hands in all the cash he holds (back under his cap, so
//                                                the done screen counts down home instead of asking him
//                                                to settle)
//
// "Tomorrow's busiest window" reads the city's orders on the same weekday last week; the in-memory API
// has no past, so a typical Aziziyah day (lunch and an evening peak) is fed to DriverAccountService
// through a demo-only wrapper of `orders.placedPerHour`, added to whatever the demo itself placed.
const NEAR_KHALID = { lat: 32.9138, lng: 45.0592 };
/** Orders per Baghdad clock hour, 0–23. */
const LAST_WEEK = [0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 6, 11, 14, 9, 5, 4, 6, 9, 13, 15, 10, 6, 2];

export default async function register(demo) {
  const { services, Accounts } = demo;
  const { DriverAccountService } = await demo.load('modules/driver-account/index.js');
  const account = demo.app.get(DriverAccountService);

  const real = account.orders;
  account.orders = new Proxy(real, {
    get(t, prop) {
      if (prop === 'placedPerHour') {
        return async (city, from, to) => {
          const counts = await t.placedPerHour(city, from, to).catch(() => new Array(24).fill(0));
          return counts.map((c, h) => c + LAST_WEEK[h]);
        };
      }
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });

  demo.route('/demo/money/shift', async ({ res, query }) => {
    const p = demo.who(query);
    const hours = Number(query.hours ?? 5);
    const presence = services.dispatch.presence;
    await presence.offline(p.personId);
    await demo.online(p.personId, NEAR_KHALID, p.vehicle ?? 'bike');
    const cur = await presence.get(p.personId);
    // Demo-only: the shift's start is backdated in the presence entry (re-registrations keep it).
    await presence.geo.put({ ...cur, onlineSince: Date.now() - hours * 3_600_000 }, 90);
    demo.json(res, 200, { personId: p.personId, onlineSince: new Date(Date.now() - hours * 3_600_000) });
  });

  demo.route('/demo/money/settle', async ({ res, query }) => {
    const p = demo.who(query);
    const e = await account.earningsFor(p.personId, 'day');
    const held = e.cash.heldIqd;
    if (held > 0) {
      await services.ledger.recordAll([
        demo.group(`demo:money:settle:${p.personId}:${Date.now()}`, new Date(), [
          { type: 'driver_settlement', amount: held, fromAccount: Accounts.bank, toAccount: Accounts.cash(p.personId), memo: 'ops_round:demo' },
        ]),
      ]);
    }
    demo.json(res, 200, { personId: p.personId, settledIqd: held });
  });
}
