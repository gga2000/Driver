import type { ServicePalette, ThemeColors } from '@driver/design-tokens';

/** The parcel screens' colours: the service's henna, the ink on it, the tag's kraft paper and its pale wash. */
export interface ParcelSwatch {
  /** The henna: the send button, the wax seal, the done steps. */
  fill: string;
  /** Text and glyphs on `fill` (AA). */
  on: string;
  /** The tag's brown paper. */
  kraft: string;
  /** Text on the kraft paper (the theme's ink: AA on `kraft` by day; the night kraft is dark, so the night ink is light). */
  kraftInk: string;
  kraftSub: string;
  /** The pale henna wash (a chosen option, the code's hint, the seal's ring). */
  wash: string;
  /** Henna-coloured text on the page (`card.dot` is ≥ 3:1; `card.sub` carries body text). */
  text: string;
}

/**
 * طرود wears henna (Ali, 2026-10-12; it may still become wine): every parcel screen reads its colours here and
 * nowhere else, so a change of colour is one change in the design tokens (`services[theme].parcel`).
 */
export function parcelSwatch(theme: { services: ServicePalette; colors: ThemeColors; scheme: 'light' | 'dark' }): ParcelSwatch {
  const p = theme.services.parcel;
  return {
    fill: p.fill,
    on: p.on,
    kraft: p.kraft,
    kraftInk: p.card.on,
    kraftSub: p.card.sub,
    wash: p.card.bg,
    text: theme.scheme === 'dark' ? p.card.dot : p.fill,
  };
}
