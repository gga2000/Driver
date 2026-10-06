import { AZIZIYAH_BOUNDS, buildGaragesGeoJSON, buildPlacedZonesGeoJSON, buildZonesGeoJSON, MAP_COLORS, metresPerDegLng, M_PER_DEG_LAT } from '@driver/map';
import type { ZonePlacementView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { tierLabel } from '@/lib/labels';

const zones = buildZonesGeoJSON();
const garages = buildGaragesGeoJSON({ onlyInCity: true });

const [[W, S], [E, N]] = AZIZIYAH_BOUNDS;
const midLat = (S + N) / 2;
// Equirectangular projection to a viewBox whose aspect follows the real ground distances.
const WIDTH = 1000;
const HEIGHT = Math.round((WIDTH * ((N - S) * M_PER_DEG_LAT)) / ((E - W) * metresPerDegLng(midLat)));
const x = (lng: number) => ((lng - W) / (E - W)) * WIDTH;
const y = (lat: number) => ((N - lat) / (N - S)) * HEIGHT;

/**
 * Plain SVG of the 34 zone hexagons and the town garages: the fallback when WebGL / MapLibre can't
 * start (old browsers, locked-down kiosks). No live layers.
 */
export function ZonesSvg({ className = '', placements }: { className?: string; placements?: readonly ZonePlacementView[] }) {
  const drawnZones = placements ? buildPlacedZonesGeoJSON(placements) : zones;
  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className={className} role="img" aria-label={t('console.legend_tiers')} style={{ background: MAP_COLORS.background }}>
      {drawnZones.features.map((f) => (
        <polygon
          key={f.properties.id}
          points={f.geometry.coordinates[0]!.map(([lng, lat]) => `${x(lng!).toFixed(1)},${y(lat!).toFixed(1)}`).join(' ')}
          fill={f.properties.color}
          fillOpacity={0.25}
          stroke={f.properties.color}
          strokeWidth={1.5}
        >
          <title>{`${f.properties.name_ar} · ${tierLabel(f.properties.tier)}`}</title>
        </polygon>
      ))}
      {garages.features.map((g) => {
        const [lng, lat] = g.geometry.coordinates as [number, number];
        return (
          <circle key={g.properties.key} cx={x(lng)} cy={y(lat)} r={7} fill={MAP_COLORS.background} stroke={MAP_COLORS.accentStrong} strokeWidth={3}>
            <title>{g.properties.name_ar}</title>
          </circle>
        );
      })}
    </svg>
  );
}
