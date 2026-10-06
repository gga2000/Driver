import { describe, expect, it } from 'vitest';
import { ROUTE_PAN_PX, ROUTE_REDRAW_MS, shouldRedraw, type RouteDraw } from './route-throttle';

const drawn: RouteDraw = { at: 1_000, x: 100, y: 200, shape: 12 };
const next = (p: Partial<RouteDraw & { zoomDrift: number; panPx: number }> = {}) => ({ at: 1_000 + ROUTE_REDRAW_MS, x: 100, y: 200, shape: 12, zoomDrift: 0, panPx: 0, ...p });

describe('route line redraw throttle (f21, L-29)', () => {
  it('draws the first time and whenever the road itself changed', () => {
    expect(shouldRedraw(null, next())).toBe(true);
    expect(shouldRedraw(drawn, next({ at: 1_001, shape: 13 }))).toBe(true);
  });
  it('at most every 66 ms (≤ 15 fps), however much he moved', () => {
    expect(ROUTE_REDRAW_MS).toBeGreaterThanOrEqual(1000 / 15);
    expect(shouldRedraw(drawn, next({ at: 1_000 + ROUTE_REDRAW_MS - 1, x: 150 }))).toBe(false);
  });
  it('then only when he moved a pixel or more, or the camera drifted far enough from the drawn one', () => {
    expect(shouldRedraw(drawn, next({ x: 100.6, y: 200.6 }))).toBe(false);
    expect(shouldRedraw(drawn, next({ x: 101, y: 200 }))).toBe(true);
    expect(shouldRedraw(drawn, next({ zoomDrift: 0.01 }))).toBe(false);
    expect(shouldRedraw(drawn, next({ zoomDrift: 0.08 }))).toBe(true);
    expect(shouldRedraw(drawn, next({ panPx: ROUTE_PAN_PX - 1 }))).toBe(false);
    expect(shouldRedraw(drawn, next({ panPx: ROUTE_PAN_PX }))).toBe(true);
  });
});
