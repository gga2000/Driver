import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PriceRequestInput } from '@driver/contracts';
import { color, space, type } from '@driver/design-tokens';
import { t } from '@driver/i18n';
import { QuoteCard } from '@/quote-card';
import { useTRPC } from '@/trpc';

/** A customer asking for a taxi from the centre to زاكور (mid tier), met at the door. */
const SAMPLE: PriceRequestInput = {
  cityId: 'aziziyah',
  vertical: 'taxi',
  stops: [
    { zoneId: 'centre', type: 'pickup' },
    { zoneId: 'zakur', type: 'dropoff' },
  ],
  options: { doorPickup: true },
  at: new Date(),
  distanceKm: 4,
  durationMin: 10,
};

export default function Home() {
  const trpc = useTRPC();
  const quote = useQuery(trpc.pricing.quote.queryOptions(SAMPLE));

  return (
    <SafeAreaView style={styles.screen}>
      <Text style={styles.brand}>{t('app.customer')}</Text>
      <Text style={styles.prompt}>{t('home.where_to')}</Text>
      <Text style={styles.sub}>المركز ← الشمالي · {t('pickup.door')}</Text>
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
  brand: { fontSize: type.display.size, fontWeight: '700', color: color.primary[600], textAlign: 'left' },
  prompt: { fontSize: type.heading.size, fontWeight: '600', color: color.neutral[900], textAlign: 'left' },
  sub: { fontSize: type.body.size, color: color.neutral[500], textAlign: 'left' },
  body: { marginTop: space[6] },
  error: { color: color.danger[700], fontSize: type.body.size },
});
