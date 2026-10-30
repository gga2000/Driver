// N20 «شارع مسدود» on the courier's side: a street closed today across his road, so the job and the offer
// bend around it, draw it, and say it in one line.
//
//   POST /demo/closure?who=courier&on=job      closes a stretch in the middle of his job's road
//   POST /demo/closure?who=courier&on=offer    … of the road to the kitchen on the offer ringing for him
//        …&name=شارع المستشفى                  what ops called it (the line names it); none = «شارع مسدود»
//   POST /demo/closure-clear                    opens every street closed in the demo again
//   POST /demo/closure-report?who=courier&reason=works   «الشارع مسدود قدامي» from his job (waits for ops)
//   POST /demo/closure-confirm?id=…              ops confirm a courier's report from the Console
//
// The closure goes through the closures service exactly as the Console's «سد الشارع» does (audit log and
// all), so routing, the arrival times and the maps see it the same way.

/** The stretch from `fromM` to `toM` metres along `line`. */
function stretch(line, fromM, toM) {
  const d = (a, b) => Math.hypot((b.lat - a.lat) * 110_540, (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180));
  const at = (a, b, t) => ({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
  const out = [];
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = d(a, b);
    if (len === 0) continue;
    const s = Math.max(fromM, run);
    const e = Math.min(toM, run + len);
    if (e > s) {
      if (out.length === 0) out.push(at(a, b, (s - run) / len));
      out.push(at(a, b, (e - run) / len));
    }
    run += len;
  }
  return { path: out, totalM: run };
}

export default async function register(demo) {
  const { services, CITY } = demo;
  const { PartnerService } = await demo.load('modules/partner/index.js');
  const { ClosuresService } = await demo.load('modules/closures/index.js');
  const { decodePolyline } = await demo.load('modules/routing/index.js');
  const partner = demo.app.get(PartnerService);
  const closures = demo.app.get(ClosuresService);
  const ops = { personId: 'demo-dispatcher', sessionId: 'demo' };
  const made = [];

  demo.route('/demo/closure', async ({ res, query }) => {
    const { personId } = demo.who(query);
    const actor = { personId, sessionId: 'demo' };
    let road;
    let to;
    if (query.on === 'offer') {
      const presence = await services.dispatch.presence.get(personId);
      const found = await services.dispatch.openOffer(personId, presence?.cityId ?? CITY);
      if (!found) return demo.json(res, 409, { error: 'no offer ringing for him: POST /demo/offer first' });
      road = await partner.offerRoute(actor, { offerId: found.offer.id });
      to = found.request.pickup;
    } else {
      road = await partner.jobRoute(actor);
      const job = await partner.activeJob(actor);
      to = job?.stops.find((s) => s.stopId === job.currentStopId)?.pin ?? null;
    }
    if (!road.from) return demo.json(res, 409, { error: 'no road for him yet (no position or no stop ahead)' });
    const line = road.polyline6 ? decodePolyline(road.polyline6) : to ? [road.from, to] : [];
    if (line.length < 2) return demo.json(res, 409, { error: 'no road to close a street on' });
    // A stretch near the middle of his road, clear of both ends (a closure at his door is not routed round).
    const { totalM } = stretch(line, 0, 0);
    const len = Math.min(220, totalM * 0.3);
    const { path } = stretch(line, totalM * 0.45 - len / 2, totalM * 0.45 + len / 2);
    const view = await closures.close(ops, { cityId: CITY, path, reason: 'works', nameAr: query.name?.trim() || null });
    made.push(view.id);
    // The road as the app now reads it: it should go around (`closures` names this one).
    const after = query.on === 'offer' ? await partner.offerRoute(actor, { offerId: (await services.dispatch.openOffer(personId, CITY))?.offer.id ?? '' }) : await partner.jobRoute(actor);
    demo.json(res, 200, { closureId: view.id, lengthM: view.lengthM, endsAt: view.endsAt, path, before: line, after: after.polyline6 ? decodePolyline(after.polyline6) : null, closures: after.closures ?? [] });
  });

  demo.route('/demo/closure-report', async ({ res, query }) => {
    const { personId } = demo.who(query);
    try {
      const r = await closures.report({ personId, sessionId: 'demo' }, { cityId: CITY, reason: query.reason ?? 'works' });
      made.push(r.id);
      demo.json(res, 200, r);
    } catch (err) {
      demo.json(res, 409, { error: err.code ?? err.message });
    }
  });

  demo.route('/demo/closure-confirm', async ({ res, query }) => {
    const view = await closures.confirm(ops, { id: String(query.id) });
    demo.json(res, 200, view);
  });

  demo.route('/demo/closure-clear', async ({ res }) => {
    for (const id of made.splice(0)) await closures.open(ops, { id }).catch(() => undefined);
    demo.json(res, 200, { ok: true });
  });
}
