import type { QuoteComponent } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import type { PriceItem } from '@driver/ui';
import type { CheckoutTotals } from './checkout';

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Named label and one-line reason per quote component (voice guide §2.5: every fee has a reason). */
const NAMES: Partial<Record<QuoteComponent['key'], { label: MessageKey; reason?: MessageKey }>> = {
  base: { label: 'quote.delivery', reason: 'quote.reason.delivery_full' },
  zone_adjust: { label: 'quote.delivery', reason: 'quote.reason.delivery_full' },
  door_pickup: { label: 'quote.door_pickup', reason: 'quote.reason.door_pickup' },
  street_pickup: { label: 'quote.street_pickup', reason: 'quote.reason.street_pickup' },
  night: { label: 'quote.night' },
  weather: { label: 'quote.rain', reason: 'quote.reason.rain' },
  peak: { label: 'quote.peak', reason: 'quote.reason.peak' },
  service_fee: { label: 'quote.service_fee', reason: 'quote.reason.service_fee' },
  small_order: { label: 'quote.small_order_fee' },
  wait: { label: 'quote.wait' },
};

/** The receipt lines for cart and checkout: items, then each non-zero delivery part, then the service fee. */
export function priceItems(totals: CheckoutTotals, t: T, locale: 'ar-IQ' | 'en'): PriceItem[] {
  const out: PriceItem[] = [{ key: 'items', label: t('quote.subtotal'), amount: totals.itemsIqd }];
  for (const c of totals.components) {
    // A zero part (door hand-over is the default, free) says nothing on a receipt.
    if (c.amount === 0) continue;
    const name = NAMES[c.key];
    out.push({
      key: `${c.key}${c.leg ?? ''}`,
      label: name ? t(name.label) : locale === 'en' ? c.label_en : c.label_ar,
      amount: c.amount,
      ...(name?.reason ? { reason: t(name.reason) } : {}),
    });
  }
  return out;
}
