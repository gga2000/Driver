import { color as palette } from '@driver/design-tokens';

type Light = 'day' | 'morning' | 'golden' | 'sunset' | 'night';

/**
 * N6 «ليش متأخر»: the slow stretch as rust and cream stripes over the route (a rust band, cream
 * dashes on it), under the street names. Brighter rust at night so it reads on the dark map.
 * Stand-in for `slowStretchLayers` from `@driver/map/golden` (map M2) until that lands.
 */
export function slowStretchLayers({ source, light }: { source: string; light: Light }) {
  const rust = light === 'night' ? '#E06A54' : palette.danger[500];
  const width = (k: number) => ['interpolate', ['linear'], ['zoom'], 13, 7 * k, 16, 14 * k, 18, 20 * k];
  return [
    {
      id: 'track-slow-band',
      type: 'line',
      source,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': rust, 'line-width': width(1), 'line-opacity': 0.95 },
    },
    {
      id: 'track-slow-stripes',
      type: 'line',
      source,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': palette.neutral[50], 'line-width': width(0.45), 'line-dasharray': [1.1, 1.3], 'line-opacity': 0.9 },
    },
  ] as const;
}
