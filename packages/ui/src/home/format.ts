import { t } from '@driver/i18n';
import { formatAmount, ltr } from '../format';

/**
 * «12,000 دينار»: the digits kept left-to-right inside the Arabic line. Not `formatIqd`: the word comes from
 * the locale (`unit.iqd`), so the English build says «IQD».
 */
export const iqd = (n: number) => t('unit.iqd', { amount: ltr(formatAmount(n)) });
/** «12 دقيقة», «5 دقايق». */
export const mins = (n: number) => t('live_map.minutes', { n });
/** The separator between facts on one line («مطعم خالد · 12 دقيقة»), from the locale. */
export const sep = () => t('home.sep');

/**
 * The home's fixed sizes in one place (audit round 3): picture heights and tile widths that the real pieces
 * and their loading shapes share, so nothing jumps when the data lands.
 */
export const homeSize = {
  dishPhoto: 188,
  pairPhoto: 112,
  restPhoto: 128,
  restWidth: 228,
  offerWidth: 148,
  offerPhoto: 84,
  usualPhoto: 56,
  mapIdle: 156,
  mapOrder: 200,
  boardTop: 216,
  boardBottom: 96,
  foodTile: 108,
  river: 4,
  /** A person's face on the panel, and the small dish photo in a row. */
  face: 40,
  thumb: 64,
  /** A live dot beside words. */
  dot: 8,
  /** The home's main buttons («ضيفه للسلة», «اطلبه» in the panel): taller than the 44 minimum. */
  button: 48,
} as const;

/** One tap, one order: a second tap within this window is ignored. */
export const GUARD_MS = 1200;
