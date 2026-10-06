/**
 * Joy f21 (L-29): the route line's SVG path is rebuilt at most this often (≤ 15 fps). Between rebuilds
 * the drawn path follows the camera with one transform (`layerTransform`) on the UI thread.
 */
export const ROUTE_REDRAW_MS = 67;
/** … and only once the courier's head moved at least this far on screen, */
export const ROUTE_MOVE_PX = 1;
/** … or the live zoom drifted this far from the drawn one (strokes would visibly thicken or thin), */
export const ROUTE_ZOOM_DRIFT = 0.05;
/** … or the camera panned this far (the drawn canvas would leave the screen edge bare). */
export const ROUTE_PAN_PX = 24;

/** What the last rebuild drew: when, where the courier's head was (in the drawn camera), and the road. */
export interface RouteDraw {
  at: number;
  x: number;
  y: number;
  /** Changes whenever the road or the stops change (always redraw then). */
  shape: number;
}

/** Whether to rebuild the route path now. A worklet: it runs on the UI thread every frame. */
export function shouldRedraw(prev: RouteDraw | null, next: RouteDraw & { zoomDrift: number; panPx: number }): boolean {
  'worklet';
  if (!prev || prev.shape !== next.shape) return true;
  if (next.at - prev.at < ROUTE_REDRAW_MS) return false;
  return Math.hypot(next.x - prev.x, next.y - prev.y) >= ROUTE_MOVE_PX || Math.abs(next.zoomDrift) >= ROUTE_ZOOM_DRIFT || next.panPx >= ROUTE_PAN_PX;
}
