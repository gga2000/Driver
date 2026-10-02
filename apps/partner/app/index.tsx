import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PriceRequestInput } from '@driver/contracts';
import { color, radius, space, type } from '@driver/design-tokens';
import { t } from '@driver/i18n';
import { QuoteCard } from '@/quote-card';
import { useTRPC } from '@/trpc';

/** An offer as the driver sees it: intercity center → Kut with a front-seat passenger. */
const OFFER: PriceRequestInput = {
  cityId: 'aziziyah',
  vertical: 'intercity',
  stops: [
    { zoneId: 'center', type: 'pickup' },
    { zoneId: 'kut', type: 'dropoff' },
  ],
  options: { frontSeat: true },
  at: new Date(),
  distanceKm: 55,
  durationMin: 50,
};

export default function Offers() {
  const trpc = useTRPC();
  const health = useQuery(trpc.health.ping.queryOptions());
  const quote = useQuery(trpc.pricing.quote.queryOptions(OFFER));
  const online = health.isSuccess;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.brand}>{t('app.partner')}</Text>
        <View style={[styles.pill, { backgroundColor: online ? color.success[50] : color.neutral[100] }]}>
          <Text style={{ color: online ? color.success[700] : color.neutral[600] }}>
            {online ? t('status.online') : t('status.offline')}
          </Text>
        </View>
      </View>
      <Text style={styles.title}>{t('partner.new_offer')}</Text>
      <Text style={styles.sub}>العزيزية ← الكوت · {t('seat.front')}</Text>
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
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brand: { fontSize: type.heading.size, fontWeight: '700', color: color.primary[600] },
  pill: { paddingHorizontal: space[3], paddingVertical: space[1], borderRadius: radius.pill },
  title: { fontSize: type.display.size, fontWeight: '700', color: color.neutral[900], textAlign: 'left', marginTop: space[4] },
  sub: { fontSize: type.body.size, color: color.neutral[500], textAlign: 'left' },
  body: { marginTop: space[6] },
  error: { color: color.danger[700], fontSize: type.body.size },
});
