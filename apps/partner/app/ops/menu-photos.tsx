import { router, Stack } from 'expo-router';
import { RefreshControl, View } from 'react-native';
import { Card, EmptyState, Skeleton, Text, useTheme } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { RequestCard } from '@/features/ops/MenuPhotoParts';
import { useMenuPhotoRequests } from '@/features/ops/queries';
import { useT } from '@/lib/i18n';

/**
 * تصوير المنيو (maps program k3) — restaurants that asked Driver to photograph their dishes, in the
 * city: his own visits first (soonest first), then requests nobody has taken. Tap one to set the
 * visit and shoot dish by dish.
 */
export default function OpsMenuPhotos() {
  const theme = useTheme();
  const t = useT();
  const list = useMenuPhotoRequests();

  return (
    <Screen edges={['bottom']} testID="ops-menu-photos" refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}>
      <Stack.Screen options={{ title: t('partner.ops_mp_title') }} />
      <Text variant="body" color="textMuted">
        {t('partner.ops_mp_intro')}
      </Text>
      {list.isError && !list.data ? (
        <Card elevation={0}>
          <EmptyState icon="x" title={t('partner.ops_mp_load_failed')} action={{ label: t('partner.ops_mp_retry'), onPress: () => void list.refetch() }} />
        </Card>
      ) : !list.data ? (
        <Skeleton lines={4} />
      ) : list.data.length === 0 ? (
        <Card elevation={0}>
          <EmptyState icon="check" title={t('partner.ops_mp_empty')} body={t('partner.ops_mp_empty_body')} />
        </Card>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          {list.data.map((r) => (
            <RequestCard key={r.requestId} testID={`ops-mp-${r.requestId}`} view={r} onPress={() => router.push({ pathname: '/ops/menu-shoot', params: { requestId: r.requestId } })} />
          ))}
        </View>
      )}
    </Screen>
  );
}
