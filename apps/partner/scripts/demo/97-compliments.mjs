// Compliments after a good rating (joy l4): the kind words customers picked for the courier.
//
//   who=courier  0770 111 0001  14 customers over the last weeks (مؤدب most), 3 of them in the last
//                               4 hours — so «كلام الزبائن» (account hub) and the shift summary's
//                               «قالوا عنك بهالشفت» both show them
//
//   who=tuktuk   0770 111 0002  6 riders' words (مؤدب، السيارة نظيفة، سياقته هادئة), so his public page
//                               (partner r4 «هيج يشوفك الزبون») shows what riders say about him
//
//   POST /demo/compliments?who=…[&keys=fast,polite]   one more customer's words now (default: سريع، الأكل وصل حار)
//
// Stored through the orders module's compliments repository (the same table the customer app writes
// through `orders.compliment`); the orders are demo ids, so only their ticket numbers show.
const HOUR = 3_600_000;

const PAST = [
  { h: 1, keys: ['polite', 'hot_food'] },
  { h: 2.5, keys: ['fast'] },
  { h: 3.5, keys: ['polite', 'found_home'] },
  { h: 26, keys: ['polite'] },
  { h: 30, keys: ['fast', 'polite'] },
  { h: 52, keys: ['hot_food'] },
  { h: 75, keys: ['polite', 'fast', 'found_home'] },
  { h: 98, keys: ['polite'] },
  { h: 121, keys: ['found_home'] },
  { h: 150, keys: ['polite', 'hot_food'] },
  { h: 190, keys: ['fast'] },
  { h: 230, keys: ['polite'] },
  { h: 300, keys: ['hot_food', 'fast'] },
  { h: 410, keys: ['polite'] },
];

export default async function register(demo) {
  const { ORDER_COMPLIMENTS_REPOSITORY } = await demo.load('modules/orders/index.js');
  const repo = demo.app.get(ORDER_COMPLIMENTS_REPOSITORY);
  let seq = 0;
  const add = (courierId, keys, at, orderType = 'food') => {
    seq += 1;
    return repo.create({ orderId: `demo_cmp_${seq}_${courierId.slice(-4)}`, courierId, customerId: `demo-fan-${seq}`, orderType, keys, createdAt: at });
  };
  const courier = demo.people.get('courier');
  if (courier) for (const p of PAST) await add(courier.personId, p.keys, new Date(Date.now() - p.h * HOUR));
  const tuktuk = demo.people.get('tuktuk');
  const RIDES = [['polite', 'smooth_ride'], ['clean_car'], ['polite'], ['polite', 'clean_car'], ['smooth_ride'], ['polite']];
  if (tuktuk) for (const [i, keys] of RIDES.entries()) await add(tuktuk.personId, keys, new Date(Date.now() - (6 + i * 30) * HOUR), 'ride');

  demo.route('/demo/compliments', async ({ res, query }) => {
    const { personId } = demo.who({ who: query.who ?? 'courier', personId: query.personId });
    const keys = (query.keys ?? 'fast,hot_food').split(',').filter(Boolean);
    const row = await add(personId, keys, new Date());
    demo.json(res, 200, { orderId: row.orderId, keys: row.keys });
  });
}
