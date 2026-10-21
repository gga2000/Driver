import { describe, expect, it } from 'vitest';
import type { LatLng } from '@driver/contracts';
import { FakeClock } from '../../shared/clock.js';
import { ClosureAwareRouter } from './closure-aware.router.js';
import { RouteClosures, runsThrough, type RouteClosure } from './closures.js';
import { decodePolyline } from './polyline.js';
import type { RouteResult, Router, TableResult } from './routing.port.js';
import { StraightLineRouter } from './straight-line.router.js';

const A: LatLng = { lat: 32.905, lng: 45.06 };
/** About `m` metres north (and `e` east) of A. */
const at = (m: number, e = 0): LatLng => ({ lat: A.lat + m / 111_195, lng: A.lng + e / (111_195 * Math.cos((A.lat * Math.PI) / 180)) });
const B = at(1_000);

/** The straight-line estimate, counting how often it is asked. */
class CountingRouter implements Router {
  calls: LatLng[][] = [];
  private readonly inner = new StraightLineRouter();
  route(points: readonly LatLng[]): Promise<RouteResult> {
    this.calls.push([...points]);
    return this.inner.route(points);
  }
  table(s: readonly LatLng[], d: readonly LatLng[]): Promise<TableResult> {
    return this.inner.table(s, d);
  }
}

/** A closed stretch of the street A→B runs along, from 400 m to 600 m north. */
const onTheWay = (endsAt: Date, id = 'cls_1'): RouteClosure => ({ id, path: [at(400), at(500), at(600)], endsAt, reason: 'works', nameAr: 'شارع المستشفى' });

function setup() {
  const clock = new FakeClock('2026-10-12T09:00:00Z');
  const book = new RouteClosures();
  const inner = new CountingRouter();
  const router = new ClosureAwareRouter(inner, book, clock);
  const later = (min: number) => new Date(clock.now().getTime() + min * 60_000);
  return { clock, book, inner, router, later };
}

describe('ClosureAwareRouter (N20)', () => {
  it('no closures: the usual route, asked once', async () => {
    const h = setup();
    const r = await h.router.route([A, B]);
    expect(r).toEqual(await new StraightLineRouter().route([A, B]));
    expect(h.inner.calls).toHaveLength(1);
  });

  it('bends around a live closure on the way: clear of it, longer, and says which one and what it adds', async () => {
    const h = setup();
    h.book.set([onTheWay(h.later(120))]);
    const direct = await new StraightLineRouter().route([A, B]);
    const r = await h.router.route([A, B]);
    expect(r.avoided).toHaveLength(1);
    expect(r.avoided![0]!.id).toBe('cls_1');
    expect(r.durationS).toBeGreaterThan(direct.durationS);
    expect(r.avoided![0]!.extraS).toBe(Math.round(r.durationS - direct.durationS));
    // The straight-line estimate gets a shape: the bent line through the extra stop, clear of the closure.
    expect(r.polyline6).not.toBeNull();
    const line = decodePolyline(r.polyline6!);
    expect(line[0]!.lat).toBeCloseTo(A.lat, 5);
    expect(line.at(-1)!.lat).toBeCloseTo(B.lat, 5);
    expect(line.length).toBe(3);
    expect(runsThrough(line, onTheWay(h.later(120)))).toBe(false);
  });

  it('a closure off the way changes nothing', async () => {
    const h = setup();
    h.book.set([{ ...onTheWay(h.later(120)), path: [at(400, 500), at(600, 500)] }]);
    const r = await h.router.route([A, B]);
    expect(r.avoided).toBeUndefined();
    expect(r.polyline6).toBeNull();
  });

  it('ignores a closure past its end, and stops bending the moment one ends', async () => {
    const h = setup();
    h.book.set([onTheWay(h.later(-1))]);
    expect((await h.router.route([A, B])).avoided).toBeUndefined();

    h.book.set([onTheWay(h.later(30), 'cls_2')]);
    expect((await h.router.route([A, B])).avoided?.map((a) => a.id)).toEqual(['cls_2']);
    h.clock.advance(31 * 60_000);
    // Same points, same book version: the cached bent route is not served past the closure's end.
    expect((await h.router.route([A, B])).avoided).toBeUndefined();
  });

  it('a trip that starts or ends on the closed street keeps its road (the door is there)', async () => {
    const h = setup();
    h.book.set([onTheWay(h.later(120))]);
    expect((await h.router.route([A, at(500)])).avoided).toBeUndefined();
  });

  it('a new closure is never served a stale cached route', async () => {
    const h = setup();
    h.book.set([{ ...onTheWay(h.later(120)), id: 'far', path: [at(400, 500), at(600, 500)] }]);
    expect((await h.router.route([A, B])).avoided).toBeUndefined();
    h.book.set([{ ...onTheWay(h.later(120)), id: 'far', path: [at(400, 500), at(600, 500)] }, onTheWay(h.later(120))]);
    expect((await h.router.route([A, B])).avoided?.map((a) => a.id)).toEqual(['cls_1']);
  });

  it('table (ranking kitchens and drivers) is not bent', async () => {
    const h = setup();
    h.book.set([onTheWay(h.later(120))]);
    expect(await h.router.table([A], [B])).toEqual(await new StraightLineRouter().table([A], [B]));
  });
});
