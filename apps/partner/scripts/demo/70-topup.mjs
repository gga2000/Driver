// Wallet top-up handed to the courier on a job (docs/api/deals-and-topup.md §2).
//
//   POST /demo/topup?who=courier[&step=at_dropoff][&amount=25000]
//        a food job at `step` (via /demo/job) for the `buyer` persona, and the buyer asks his app for
//        a cash top-up → {code, amountIqd, orderId, tripId}. The courier types the code on
//        "الزبون يريد يشحن محفظته" and confirms through partner.topUpLookup / partner.confirmTopUp.
export default async function register(demo) {
  const { TopUpService } = await demo.load('modules/topups/index.js');
  const topups = demo.app.get(TopUpService);

  demo.route('/demo/topup', async ({ req, res, query }) => {
    const step = query.step ?? 'at_dropoff';
    const amountIqd = Number(query.amount ?? 25_000);
    // Reuse the core section's job builder over the wire (same process): the buyer's order, carried by him.
    const r = await fetch(
      `http://${req.headers.host}/demo/job?who=${encodeURIComponent(query.who ?? 'courier')}&step=${step}`,
      { method: 'POST' },
    );
    if (!r.ok) throw new Error(`/demo/job: ${r.status} ${await r.text()}`);
    const job = await r.json();
    const buyer = demo.people.get('buyer').personId;
    const view = await topups.request({ personId: buyer, sessionId: 'demo' }, { amountIqd });
    demo.json(res, 200, { code: view.code, amountIqd: view.amountIqd, ...job });
  });
}
