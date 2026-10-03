import type { Quote, QuoteComponent } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { Card, PriceBreakdown, type PriceItem } from '@driver/ui';

/** Reason lines per component (voice spec: every fee has a reason), where one exists. */
const REASON: Partial<Record<QuoteComponent['key'], MessageKey>> = {
  service_fee: 'quote.reason.service_fee',
  door_pickup: 'quote.reason.door_pickup',
  street_pickup: 'quote.reason.street_pickup',
  peak: 'quote.reason.peak',
  weather: 'quote.reason.rain',
};

export function quoteItems(quote: Quote): PriceItem[] {
  return [
    ...quote.components.map((c, i) => ({
      key: `${c.key}-${c.leg ?? i}`,
      label: c.label_ar,
      amount: c.amount,
      reason: REASON[c.key] ? t(REASON[c.key]!) : undefined,
    })),
    ...quote.shadowComponents.map((c, i) => ({ key: `shadow-${c.key}-${i}`, label: c.label_ar, amount: c.amount, shadow: true })),
  ];
}

/** The server's quote as named lines with the locked total (rounding shown as its own line). */
export function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <Card>
      <PriceBreakdown items={quoteItems(quote)} total={quote.total} note={quote.lockedAt ? t('quote.quote_locked') : undefined} />
    </Card>
  );
}
