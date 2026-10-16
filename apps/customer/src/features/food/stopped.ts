import type { MessageKey } from '@driver/i18n';
import { apiErrorCode, apiErrorMessage } from '@/lib/api-links';

const STOPS: Record<string, MessageKey> = { service_paused: 'error.service_paused', zone_at_capacity: 'error.zone_at_capacity' };

/**
 * REL-16: `orders.quote` refuses while ops have stopped food here (`service_paused`, with the switch's
 * own words) or the zone is full (`zone_at_capacity`, with the honest wait). Cart and checkout say it
 * calmly and keep the order button off; any other quote failure keeps its own handling (null).
 */
export function quoteStop(err: unknown, t: (key: MessageKey) => string, locale: 'ar-IQ' | 'en' = 'ar-IQ'): string | null {
  const code = apiErrorCode(err);
  const key = code ? STOPS[code] : undefined;
  return key ? apiErrorMessage(err, t(key), locale) : null;
}

/**
 * The closed line on a shop's page, cart and checkout. A quick pause or the opening hours say when the
 * shop is back; with no time (a tablet offline past its pause, h5, or an early close with no return
 * time) the line never promises one: «يرجع الساعة » with nothing after it reads as broken.
 */
export function closedLine(
  restaurant: { closedReason?: string | null; opensAt?: string | null },
  t: (key: MessageKey, params?: Record<string, string>) => string,
): string {
  const time = restaurant.opensAt;
  if (restaurant.closedReason === 'paused') return time ? t('restaurant.paused_until', { time }) : t('error.merchant_paused');
  return time ? t('error.merchant_closed', { time }) : t('error.merchant_closed_now');
}
