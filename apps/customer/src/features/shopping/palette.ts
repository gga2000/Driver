import { useTheme } from '@driver/ui';

/**
 * The shopping side's own colour (Ali, 2026-10-11, round 2): leaf green, the green of a stall's
 * herbs, never teal or blue. It belongs next to the other services in `@driver/design-tokens`
 * (`services`); it lives here until the tokens' owner adds it, and every shopping screen reads it
 * through `useShopping()` so the move is one import.
 */
export interface ShoppingSwatch {
  /** Buttons, the basket bar, the دوّرلي card. */
  fill: string;
  /** Text and icons on `fill` (AA). */
  on: string;
  /** Soft wash for chips, banners and the selected weight. */
  tint: string;
  /** Text on `tint` (AA). */
  onTint: string;
  /** A price that went up since yesterday (AA on the card). */
  up: string;
  /** A price that went down (AA on the card). */
  down: string;
}

const day: ShoppingSwatch = { fill: '#2C6E2A', on: '#FFFFFF', tint: '#E3F0DA', onTint: '#1F4F1D', up: '#9A4A0A', down: '#2C6E2A' };
const night: ShoppingSwatch = { fill: '#6FB766', on: '#0E1A0D', tint: '#1F2E1C', onTint: '#C4E6B9', up: '#F0A867', down: '#8FD184' };

export function useShopping(): ShoppingSwatch {
  return useTheme().scheme === 'dark' ? night : day;
}
