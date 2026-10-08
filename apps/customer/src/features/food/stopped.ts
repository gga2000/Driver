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
