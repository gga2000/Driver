// Core seed (wave 1): the launch restaurants, the four partner personas, a customer-only number for
// the role gate, a few other couriers on the map, and today's money for the courier.
//
//   who=courier    0770 111 0001  حيدر كاظم    courier, bike   — 12,500 · 6 طلبات today, 45,000 cash held
//   who=tuktuk     0770 111 0002  عباس فاضل    driver, tuktuk  — online in الهاشمي
//   who=intercity  0770 111 0003  مصطفى جاسم   intercity_driver, car
//   who=khat       0770 111 0004  كرار عادل    khat_driver, van
//   who=customer   0770 111 0009  (customer only → "حسابك مو مفعّل كشريك بعد")
//   who=buyer      0770 111 0010  the customer whose orders the demo places
export default async function register(demo) {
  const { services, Accounts } = demo;

  const seeded = await demo.seedStorefronts(services.orgs, services.catalog, undefined, 'demo-owner');
  // Demo restaurants stay open around the clock so screens and shots work at any hour
  // (DEMO_HOURS=real keeps the real opening hours, e.g. to show the "closed" states).
  if (process.env.DEMO_HOURS !== 'real') {
    for (const s of seeded) {
      const front = await services.catalog.storefront(s.orgId);
      if (front && front.hours.length > 0) await services.catalog.saveStorefront({ ...front, hours: [] });
    }
  }
  await services.orgs.settled?.();
  demo.restaurants = Object.fromEntries(seeded.map((s) => [s.seed.key, s]));

  const courier = await demo.person({ key: 'courier', phone: '07701110001', name: 'حيدر كاظم', roles: ['courier'], vehicle: 'bike', plate: 'واسط 45678' });
  const tuktuk = await demo.person({ key: 'tuktuk', phone: '07701110002', name: 'عباس فاضل', roles: ['driver'], vehicle: 'tuktuk', plate: 'واسط 31207' });
  await demo.person({ key: 'intercity', phone: '07701110003', name: 'مصطفى جاسم', roles: ['intercity_driver'], vehicle: 'car', plate: 'بغداد 88412' });
  await demo.person({ key: 'khat', phone: '07701110004', name: 'كرار عادل', roles: ['khat_driver'], vehicle: 'van', plate: 'واسط 50923' });
  await demo.person({ key: 'customer', phone: '07701110009', name: 'زينب' });
  const buyer = await demo.person({ key: 'buyer', phone: '07701110010', name: 'علي' });
  await services.ledger.recordAll(demo.group(`demo:buyer:topup`, demo.hoursAgo(30), [{ type: 'credit_issued', amount: 500_000, fromAccount: Accounts.bank, toAccount: Accounts.customer(buyer), memo: 'topup:agent' }]));

  // Other couriers around town (the demand hint counts them; nobody is offered our demo jobs).
  const others = [
    ['07701110021', 'مرتضى سالم', { lat: 32.8962, lng: 45.0671 }],
    ['07701110022', 'سجاد ناصر', { lat: 32.9135, lng: 45.067 }],
    ['07701110023', 'علي حسين', { lat: 32.9055, lng: 45.0605 }],
  ];
  for (const [phone, name, at] of others) {
    const id = await demo.person({ phone, name, roles: ['courier'], vehicle: 'bike' });
    await demo.online(id, at, 'bike');
  }
  await demo.online(tuktuk, { lat: 32.896, lng: 45.0675 }, 'tuktuk');

  // The courier's day so far: six deliveries (12,500) and 45,000 of customers' cash in his pocket.
  const fees = [1000, 1500, 2000, 3000, 2500, 2500];
  const groups = fees.map((fee, i) =>
    demo.group(`demo:courier:day:${i}`, demo.hoursAgo(6 - i), [{ type: 'delivery_fee', amount: fee, fromAccount: Accounts.customer('demo-buyer'), toAccount: Accounts.driver(courier) }], { orderId: `demo-day-${i}` }),
  );
  groups.push(demo.group('demo:courier:cash', demo.hoursAgo(1), [{ type: 'cash_collected', amount: 45_000, fromAccount: Accounts.cash(courier), toAccount: Accounts.customer('demo-buyer') }]));
  await services.ledger.recordAll(groups);
}
