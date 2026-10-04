import { AZIZIYAH_CENTRE, AZIZIYAH_ZONES, type RoundStop } from '@driver/contracts';
import { AZIZIYAH_BOUNDS, buildZonesGeoJSON, MAP_COLORS, metresPerDegLng, M_PER_DEG_LAT } from '@driver/map';
import { t } from '@driver/i18n';
import { formatIqd } from '@/lib/format';

const zones = buildZonesGeoJSON();
const CENTROIDS = new Map(AZIZIYAH_ZONES.map((z) => [z.id, z] as const));

const [[W, S], [E, N]] = AZIZIYAH_BOUNDS;
const midLat = (S + N) / 2;
// The same equirectangular projection as the zones fallback map (zones-svg.tsx).
const WIDTH = 1000;
const HEIGHT = Math.round((WIDTH * ((N - S) * M_PER_DEG_LAT)) / ((E - W) * metresPerDegLng(midLat)));
const x = (lng: number) => ((lng - W) / (E - W)) * WIDTH;
const y = (lat: number) => ((N - lat) / (N - S)) * HEIGHT;

/**
 * The 23:00 collection round on the zone map: the ops base (town centre), then each stop in route
 * order, numbered, sized by the cash to collect there. Zones without couriers stay faint.
 */
export function RoundMap({ stops, className = '' }: { stops: readonly RoundStop[]; className?: string }) {
  const placed = stops.filter((s) => CENTROIDS.has(s.zoneKey));
  const max = Math.max(1, ...placed.map((s) => s.totalIqd));
  const active = new Set(placed.map((s) => s.zoneKey));
  const path = [AZIZIYAH_CENTRE, ...placed.map((s) => CENTROIDS.get(s.zoneKey)!)].map((p) => `${x(p.lng).toFixed(1)},${y(p.lat).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={className} role="img" aria-label={t('console.fin_round_map')} style={{ background: MAP_COLORS.background }}>
      {zones.features.map((f) => (
        <polygon
          key={f.properties.id}
          points={f.geometry.coordinates[0]!.map(([lng, lat]) => `${x(lng!).toFixed(1)},${y(lat!).toFixed(1)}`).join(' ')}
          fill={active.has(f.properties.id) ? MAP_COLORS.accentStrong : f.properties.color}
          fillOpacity={active.has(f.properties.id) ? 0.18 : 0.08}
          stroke={f.properties.color}
          strokeOpacity={0.5}
          strokeWidth={1}
        >
          <title>{f.properties.name_ar}</title>
        </polygon>
      ))}
      {placed.length > 0 && <polyline points={path} fill="none" stroke={MAP_COLORS.accentStrong} strokeWidth={4} strokeDasharray="10 8" strokeLinejoin="round" />}
      <g>
        <rect x={x(AZIZIYAH_CENTRE.lng) - 12} y={y(AZIZIYAH_CENTRE.lat) - 12} width={24} height={24} rx={4} fill={MAP_COLORS.background} stroke={MAP_COLORS.accentStrong} strokeWidth={3} />
        <title>{t('console.fin_round_base')}</title>
      </g>
      {placed.map((s) => {
        const c = CENTROIDS.get(s.zoneKey)!;
        const r = 34 + Math.round((s.totalIqd / max) * 16);
        return (
          <g key={s.zoneKey}>
            <circle cx={x(c.lng)} cy={y(c.lat)} r={r} fill={MAP_COLORS.accentStrong} className={s.couriers.some((k) => k.overCap) ? 'fill-bad-solid' : undefined} stroke={MAP_COLORS.background} strokeWidth={4} />
            <text x={x(c.lng)} y={y(c.lat)} textAnchor="middle" dominantBaseline="central" fontSize={38} fontWeight={700} className="fill-on-accent">
              {s.seq}
            </text>
            <title>{`${s.seq}. ${s.zone_ar} · ${formatIqd(s.totalIqd)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
