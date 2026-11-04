import { t } from '@driver/i18n';
import { formatAmount, ltr } from '../format';

/**
 * «12,000 دينار»: the digits kept left-to-right inside the Arabic line. Not `formatIqd`: the word comes from
 * the locale (`unit.iqd`), so the English build says «IQD».
 */
export const iqd = (n: number) => t('unit.iqd', { amount: ltr(formatAmount(n)) });
/** «12 دقيقة», «5 دقايق»: always whole minutes (a server 12.5 reads «13 دقيقة», with the right plural). */
export const mins = (n: number) => t('live_map.minutes', { n: Math.max(0, Math.round(n)) });
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
  /** The flat points chip, the late band and the step bars. */
  chip: 32,
  band: 40,
  bar: 6,
  /** Outlines on the next step and on round buttons. */
  outline: 1.5,
  /** Icons beside words. */
  icon: 18,
  iconSm: 14,
  /** The chip's check, and the round «+» on a dish (bigger, so the tap reads). */
  iconChip: 16,
  iconPlus: 22,
  /** The home's main buttons («ضيفه للسلة», «اطلبه» in the panel): taller than the 44 minimum. */
  button: 48,
  /** The two gaps below the 4 px space step: a hairline between stacked lines, and a dot beside its words. */
  gapHair: 2,
  gapTight: 6,
  /** The cut-out pictures on the live board, sized per tile (they sit in the tile's corner and never crowd the words). */
  boardArt: { food: { w: 104, h: 100 }, taxi: { w: 72, h: 44 }, tuktuk: { w: 46, h: 46 }, intercity: { w: 72, h: 32 }, small: 64, inset: 4 },
} as const;

/** One tap, one order: a second tap within this window is ignored. */
export const GUARD_MS = 1200;

/** An invisible mark that stands in a translation for a piece drawn in its own colour (the price). */
export const SLOT = '\u2063';

/**
 * Split a translated line around `SLOT`: «مطعم خالد · {price} · 30 دقيقة» → before and after the price.
 * A translation that lost the slot still shows the price, after the line and a separator.
 */
export function splitSlot(line: string): [string, string] {
  const at = line.indexOf(SLOT);
  return at < 0 ? [`${line} ${sep()} `, ''] : [line.slice(0, at), line.slice(at + SLOT.length)];
}
