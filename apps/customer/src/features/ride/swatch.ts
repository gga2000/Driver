import type { RideVertical } from './logic';

/** A ride service's own colour and the ink on it (AA). */
export interface RideSwatch {
  fill: string;
  on: string;
}

/**
 * The taxi yellow and the tuktuk plum (Date & Saffron, Ali 2026-10-06/07), for the cards that wear
 * the service's colour (ride ideas d4, d5). The same values as the home tiles' `services.taxi` /
 * `services.tuktuk` in the design tokens of the home redesign (draft PR #7); once that lands, read
 * them from `services[theme.name]` and delete this file.
 */
const DAY: Record<RideVertical, RideSwatch> = {
  taxi: { fill: '#FFD84D', on: '#2A1D00' },
  tuktuk: { fill: '#8A3F93', on: '#FFFFFF' },
};
const NIGHT: Record<RideVertical, RideSwatch> = {
  taxi: { fill: '#F2C94C', on: '#1A1004' },
  tuktuk: { fill: '#7E3A88', on: '#FFFFFF' },
};

export function rideSwatch(vertical: RideVertical, scheme: 'light' | 'dark'): RideSwatch {
  return (scheme === 'dark' ? NIGHT : DAY)[vertical];
}
