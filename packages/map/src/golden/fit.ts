type LngLat = [number, number];

export interface FitOptions {
  /** The map's size on screen, px. */
  width: number;
  height: number;
  padding?: { top?: number; bottom?: number; left?: number; right?: number };
  /** The camera's heading, degrees; the box is fitted as the screen will show it. */
  bearing?: number;
  maxZoom?: number;
}

const TILE = 512;
const mx = (lng: number) => (lng + 180) / 360;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const lngOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;

/**
 * The centre and zoom that show every point inside the padded screen, at a heading (the phones' map
 * has no `fitBounds` with a heading or a zoom cap, and its own fit flattens the tilt). Fitted flat:
 * the tilt then only adds room at the top of the screen.
 */
export function fitCamera(points: readonly LngLat[], o: FitOptions): { center: LngLat; zoom: number } {
  if (!points.length) throw new Error('fitCamera needs at least one point');
  const pad = { top: 0, bottom: 0, left: 0, right: 0, ...o.padding };
  const b = ((o.bearing ?? 0) * Math.PI) / 180;
  const cos = Math.cos(b), sin = Math.sin(b);
  // World units, turned so the screen's up is the camera's heading.
  const rot = points.map(([lng, lat]) => {
    const x = mx(lng), y = my(lat);
    return [x * cos + y * sin, -x * sin + y * cos] as const;
  });
  const xs = rot.map((p) => p[0]), ys = rot.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = Math.max(1, o.width - pad.left - pad.right);
  const h = Math.max(1, o.height - pad.top - pad.bottom);
  const span = Math.max((x1 - x0) / w, (y1 - y0) / h, 1e-12);
  const zoom = Math.min(o.maxZoom ?? 22, Math.log2(1 / (span * TILE)));
  // The box's centre, moved by the padding difference (in world units at that zoom), turned back.
  const scale = TILE * 2 ** zoom;
  const cx = (x0 + x1) / 2 + ((pad.right - pad.left) / 2) / scale;
  const cy = (y0 + y1) / 2 + ((pad.bottom - pad.top) / 2) / scale;
  const x = cx * cos - cy * sin, y = cx * sin + cy * cos;
  return { center: [lngOf(x), latOf(y)], zoom };
}
