import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PriceRequestInput } from '@driver/contracts';
import { color, space, type } from '@driver/design-tokens';
import { t } from '@driver/i18n';
import { QuoteCard } from '@/quote-card';
import { useTRPC } from '@/trpc';

/** Delivery fee the merchant's customer will see: restaurant in the centre, customer in الهاشمي (near). */
const DELIVERY: PriceRequestInput = {
  cityId: 'aziziyah',
  vertical: 'food',
  stops: [
    { zoneId: 'centre', type: 'pickup' },
    { zoneId: 'hashimi', type: 'dropoff' },
  ],
  options: { doorPickup: true },
  at: new Date(),
  distanceKm: 3.5,
  durationMin: 12,
};

export default function Orders() {
  const trpc = useTRPC();
  const quote = useQuery(trpc.pricing.quote.queryOptions(DELIVERY));

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.brand}>{t('app.merchant')}</Text>
      <Text style={styles.title}>{t('merchant.new_order')}</Text>
      <Text style={styles.sub}>أجرة التوصيل · المركز ← الجنوبي</Text>
      <View style={styles.body}>
        {quote.isPending && <ActivityIndicator color={color.primary[500]} />}
        {quote.isError && <Text style={styles.error}>{t('error.network')}</Text>}
        {quote.data && <QuoteCard quote={quote.data} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.neutral[50], padding: space[5], gap: space[2] },
  brand: { fontSize: type.heading.size, fontWeight: '700', color: color.primary[600], textAlign: 'left' },
  title: { fontSize: type.display.size, fontWeight: '700', color: color.neutral[900], textAlign: 'left', marginTop: space[4] },
  sub: { fontSize: type.body.size, color: color.neutral[500], textAlign: 'left' },
  body: { marginTop: space[6] },
  error: { color: color.danger[700], fontSize: type.body.size },
});
