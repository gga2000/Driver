import type { CartCard } from '@driver/contracts';
import { formatHourPart } from '@driver/i18n';
import type { useT } from '@/lib/i18n';
import { usualHour } from './look';

type T = ReturnType<typeof useT>;

/**
 * The one line that says where a cart stands: «فاتح لـ 12:30 بالليل» (the owner's word tonight, else
 * his usual), «فاتح هسة», the away note («ترجع برمضان»), «يفتح عادة 6 المسا», or «مسكّر».
 */
export function cartStatus(t: T, card: Pick<CartCard, 'open' | 'closesAt' | 'usual' | 'awayNote'>, locale: 'ar-IQ' | 'en'): string {
  if (card.open) {
    if (card.closesAt) return t('carts.open_till', { time: formatHourPart(card.closesAt, { locale }) });
    if (card.usual) return t('carts.open_till', { time: usualHour(card.usual.to, locale) });
    return t('carts.open_now');
  }
  if (card.awayNote) return card.awayNote;
  if (card.usual) return t('carts.opens_usually', { time: usualHour(card.usual.from, locale) });
  return t('carts.closed');
}

/** The strip's short word under a followed cart: «فاتح», its usual hour, or the away note. */
export function cartStatusShort(t: T, card: Pick<CartCard, 'open' | 'usual' | 'awayNote'>, locale: 'ar-IQ' | 'en'): string {
  if (card.open) return t('carts.open_short');
  if (card.awayNote) return card.awayNote;
  if (card.usual) return usualHour(card.usual.from, locale);
  return t('carts.closed');
}
