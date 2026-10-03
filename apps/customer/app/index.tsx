import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PriceRequestInput } from '@driver/contracts';
import { t } from '@driver/i18n';
import {
  Avatar,
  Button,
  Card,
  EmptyState,
  formatIqd,
  IconButton,
  SearchField,
  SegmentedControl,
  Skeleton,
  StatusPill,
  Text,
  useTheme,
} from '@driver/ui';
import { QuoteCard } from '@/quote-card';
import { useTRPC } from '@/trpc';

/** A customer asking for a taxi from the centre to زاكور (mid tier). */
function sampleRequest(doorPickup: boolean): PriceRequestInput {
  return {
    cityId: 'aziziyah',
    vertical: 'taxi',
    stops: [
      { zoneId: 'centre', type: 'pickup' },
      { zoneId: 'zakur', type: 'dropoff' },
    ],
    options: { doorPickup },
    at: new Date(),
    distanceKm: 4,
    durationMin: 10,
  };
}

export default function Home() {
  const theme = useTheme();
  const trpc = useTRPC();
  const [query, setQuery] = useState('');
  const [pickup, setPickup] = useState<'door' | 'street'>('door');
  const quote = useQuery(trpc.pricing.quote.queryOptions(sampleRequest(pickup === 'door')));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: theme.space[5], gap: theme.space[5] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name="علي" size={44} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="textMuted">
              {t('checkout.deliver_to')}
            </Text>
            <Text variant="bodyStrong">البيت، شارع 30</Text>
          </View>
          <IconButton icon="bell" accessibilityLabel="الإشعارات" variant="outline" badge />
        </View>

        <Text variant="display">{t('home.where_to')}</Text>
        <SearchField value={query} onChangeText={setQuery} placeholder={t('search.placeholder')} onClear={() => setQuery('')} onVoice={() => {}} />

        <Card padding={4}>
          <View style={{ gap: theme.space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text variant="title">{t('home.section_taxi')}</Text>
              <StatusPill label="المركز ← زاكور" tone="accent" icon="car" size="sm" />
            </View>
            <SegmentedControl
              accessibilityLabel={t('checkout.pickup_mode')}
              value={pickup}
              onChange={setPickup}
              options={[
                { value: 'door', label: t('pickup.door') },
                { value: 'street', label: t('pickup.street') },
              ]}
            />
          </View>
        </Card>

        {quote.isPending ? (
          <Card>
            <View accessibilityLabel={t('status.loading')} style={{ gap: theme.space[3] }}>
              <Skeleton lines={4} />
              <Skeleton height={32} width="50%" />
            </View>
          </Card>
        ) : quote.isError ? (
          <Card elevation={0}>
            <EmptyState icon="x" title={t('error.network')} action={{ label: t('action.retry'), onPress: () => void quote.refetch() }} />
          </Card>
        ) : (
          <>
            <QuoteCard quote={quote.data} />
            <Button label={t('home.order_now')} trailing={formatIqd(quote.data.total)} size="lg" fullWidth haptic="medium" />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
