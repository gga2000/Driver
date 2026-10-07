import { router } from 'expo-router';
import { View } from 'react-native';
import type { FavouriteDriverView } from '@driver/contracts';
import { Button, Card, EmptyState, Icon, RetryState, retryKindFor, SketchScene, Skeleton, StatusPill, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { GuestGate } from '@/components/GuestGate';
import { Screen } from '@/components/Screen';
import { DriverFace } from '@/features/ride-habits/Cards';
import { useFavourites, useUnfavourite } from '@/features/ride-habits/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * «سواقي المفضلين» (joy l9): the drivers this person hearted after a ride or الرجعة rated 4–5 — face,
 * first name, what they drive for him and how many trips together. A booked ride or a regular trip
 * may ask for one; on-demand rides never do. The driver never sees this list.
 */
export default function DriversPage() {
  return useSignedIn() ? <Drivers /> : <GuestGate kind="account" />;
}

function Drivers() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const favs = useFavourites();
  const list = favs.data;

  return (
    <Screen edges={['bottom']} testID="drivers">
      {favs.isError && !list ? (
        <RetryState
          kind={retryKindFor({ net, error: favs.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          {...(retryKindFor({ net, error: favs.error }) === 'server' ? { title: t('habits.fav_load_error') } : {})}
          onRetry={() => void favs.refetch()}
        />
      ) : !list ? (
        <View style={{ gap: theme.space[3] }} testID="drivers-loading">
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState icon="heart" title={t('habits.fav_empty_title')} body={t('habits.fav_empty_body')} action={{ label: t('habits.fav_empty_cta'), onPress: () => router.push('/ride') }} />
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {list.map((f) => (
            <FavouriteRow key={f.id} f={f} />
          ))}
        </View>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], paddingVertical: theme.space[2] }}>
        <Icon name="shield" size={16} color="textMuted" />
        <Text variant="caption" color="textMuted" style={{ flex: 1 }} testID="drivers-private">
          {t('habits.fav_private')}
        </Text>
      </View>
    </Screen>
  );
}

function FavouriteRow({ f }: { f: FavouriteDriverView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const remove = useUnfavourite();
  const name = f.firstName ?? t('habits.fav_unnamed');
  const kinds = f.kinds.map((k) => t(`habits.fav_kind_${k}`)).join(' · ');
  const drop = () =>
    remove.mutate(
      { favouriteId: f.id },
      {
        onSuccess: () => toast.show({ message: t('habits.fav_removed', { name }), tone: 'neutral', icon: 'heart' }),
        onError: (e) => toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' }),
      },
    );
  return (
    <Card padding={4} elevation={1} testID={`driver-${f.id}`}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <DriverFace name={f.firstName} photoUrl={f.photoUrl} size={56} />
          <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
            <Text variant="title" numberOfLines={1}>
              {name}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {kinds}
            </Text>
            {f.tripsTogether > 0 ? (
              <Text variant="caption" color="textMuted" tabular>
                {t('habits.fav_together', { n: f.tripsTogether })}
              </Text>
            ) : null}
          </View>
          <StatusPill label={t('habits.fav_badge')} tone="accent" icon="heart" size="sm" />
        </View>
        <Button testID={`driver-remove-${f.id}`} variant="ghost" label={t('habits.fav_remove')} loading={remove.isPending} onPress={drop} />
      </View>
    </Card>
  );
}
