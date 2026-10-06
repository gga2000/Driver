import { AZIZIYAH_CENTRE, AZIZIYAH_ZONES, type RoundStop } from '@driver/contracts';
import { AZIZIYAH_BOUNDS, buildZonesGeoJSON, metresPerDegLng, M_PER_DEG_LAT } from '@driver/map';
import { t } from '@driver/i18n';
import { formatMoney } from '@/lib/format';
import { spreadBadges } from '@/lib/round';

const zones = buildZonesGeoJSON();
const CENTROIDS = new Map(AZIZIYAH_ZONES.map((z) => [z.id, z] as const));

const [[W, S], [E, N]] = AZIZIYAH_BOUNDS;
const midLat = (S + N) / 2;
// The same equirectangular projection as the zones fallback map (zones-svg.tsx).
const WIDTH = 1000;
const HEIGHT = Math.round((WIDTH * ((N - S) * M_PER_DEG_LAT)) / ((E - W) * metresPerDegLng(midLat)));
const x = (lng: number) => ((lng - W) / (E - W)) * WIDTH;
const y = (lat: number) => ((N - lat) / (N - S)) * HEIGHT;

/** The part of the town the round covers (base + stops), padded, never smaller than a few zones. */
export function roundViewBox(points: ReadonlyArray<readonly [number, number]>): [number, number, number, number] {
  if (points.length === 0) return [0, 0, WIDTH, HEIGHT];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minW = 320;
  let w = Math.max(...xs) - Math.min(...xs);
  let h = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  w = Math.max(minW, w * 1.5 + 120);
  h = Math.max(minW * 0.75, h * 1.5 + 120);
  // Keep a 4:3 frame so the card doesn't jump between rounds.
  if (w / h > 4 / 3) h = (w * 3) / 4;
  else w = (h * 4) / 3;
  return [cx - w / 2, cy - h / 2, w, h];
}

/**
 * The 23:00 collection round on a light zone map: the ops office (a square), then each stop in route
 * order, numbered, sized by the cash to collect there; a stop with a courier over his cap is red and
 * says so in its title. Zones on the route are tinted; the rest stay paper. Colours are theme roles.
 */
export function RoundMap({ stops, className = '' }: { stops: readonly RoundStop[]; className?: string }) {
  const placed = stops.filter((s) => CENTROIDS.has(s.zoneKey));
  const max = Math.max(1, ...placed.map((s) => s.totalIqd));
  const active = new Set(placed.map((s) => s.zoneKey));
  const pts = [AZIZIYAH_CENTRE, ...placed.map((s) => CENTROIDS.get(s.zoneKey)!)].map((p) => [x(p.lng), y(p.lat)] as const);
  const [vx, vy, vw, vh] = roundViewBox(pts);
  const k = vw / 520; // marks keep the same size on screen whatever the zoom
  const labels = placed.length <= 5;
  const path = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const radius = (s: RoundStop) => (14 + Math.round((s.totalIqd / max) * 8)) * k;
  // Stops in neighbouring zones (and the ones next to the office) would stack their numbers: each
  // badge moves just clear of the others and of the office square, with a leader back to its zone.
  const spread = spreadBadges(
    placed.map((s, i) => ({ x: pts[i + 1]![0], y: pts[i + 1]![1], r: radius(s) })),
    [{ x: pts[0]![0], y: pts[0]![1], r: 12 * k }],
    2 * k,
  );
  const at = new Map(placed.map((s, i) => [s.zoneKey, spread[i]!] as const));
  return (
    <svg viewBox={`${vx} ${vy} ${vw} ${vh}`} className={className} role="img" aria-label={t('console.fin_round_map_aria', { n: placed.length })}>
      <rect x={vx} y={vy} width={vw} height={vh} className="fill-surface-2" />
      {zones.features.map((f) => {
        const on = active.has(f.properties.id);
        return (
          <polygon
            key={f.properties.id}
            points={f.geometry.coordinates[0]!.map(([lng, lat]) => `${x(lng!).toFixed(1)},${y(lat!).toFixed(1)}`).join(' ')}
            className={on ? 'fill-accent-tint stroke-accent' : 'fill-surface stroke-line-strong'}
            strokeOpacity={on ? 0.9 : 0.35}
            strokeWidth={1.2 * k}
          >
            <title>{f.properties.name_ar}</title>
          </polygon>
        );
      })}
      {placed.length > 0 && <polyline points={path} fill="none" className="stroke-accent-text" strokeWidth={3 * k} strokeDasharray={`${8 * k} ${6 * k}`} strokeLinejoin="round" strokeLinecap="round" />}
      {/* Where each stop really is: a dot on its zone, and a leader to its badge when the badge moved. */}
      {placed.map((s, i) => {
        const b = at.get(s.zoneKey)!;
        const [zx, zy] = pts[i + 1]!;
        if (Math.hypot(b.x - zx, b.y - zy) < 1) return null;
        return (
          <g key={`leader-${s.zoneKey}`}>
            <line x1={zx} y1={zy} x2={b.x} y2={b.y} className="stroke-accent-text" strokeWidth={1.5 * k} />
            <circle cx={zx} cy={zy} r={3 * k} className="fill-accent-text" />
          </g>
        );
      })}
      {/* Later stops first, so the first stops sit on top where the route doubles back. */}
      {[...placed].reverse().map((s) => {
        const b = at.get(s.zoneKey)!;
        const r = radius(s);
        const over = s.couriers.some((q) => q.overCap);
        return (
          <g key={s.zoneKey}>
            <circle cx={b.x} cy={b.y} r={r} className={over ? 'fill-bad-solid stroke-surface' : 'fill-accent stroke-surface'} strokeWidth={3 * k} />
            <text x={b.x} y={b.y} textAnchor="middle" dominantBaseline="central" fontSize={15 * k} fontWeight={700} className={over ? 'fill-on-bad' : 'fill-on-accent'}>
              {s.seq}
            </text>
            {/* Names only while they fit; a long round is read from the numbered list beside the map. */}
            {labels && (
              <text x={b.x} y={b.y + r + 13 * k} textAnchor="middle" fontSize={12 * k} fontWeight={600} className="fill-text" style={{ paintOrder: 'stroke' }} stroke="rgb(var(--c-surface))" strokeWidth={4 * k}>
                {s.zone_ar}
              </text>
            )}
            <title>{`${s.seq}. ${s.zone_ar} · ${formatMoney(s.totalIqd)}${over ? ` · ${t('console.fin_over_cap_short')}` : ''}`}</title>
          </g>
        );
      })}
      <g>
        <rect x={pts[0]![0] - 8 * k} y={pts[0]![1] - 8 * k} width={16 * k} height={16 * k} rx={3 * k} className="fill-text stroke-surface" strokeWidth={3 * k} />
        <title>{t('console.fin_round_base')}</title>
      </g>
    </svg>
  );
}
