import { router } from 'expo-router';
import { View } from 'react-native';
import {
  Button,
  Card,
  EmptyState,
  Icon,
  RetryState,
  retryKindFor,
  SketchScene,
  Skeleton,
  Text,
  useNetwork,
  useTheme,
} from '@driver/ui';
import { Screen } from '@/components/Screen';
import { GuestGate } from '@/components/GuestGate';
import { useAccess } from '@/features/access/queries';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * «نبلّغك من يصير دورك» (customer waves, W5): more people want to order than the kitchens can cook,
 * so food orders open area by area. Says why in one line, which area, how many are ahead, that a
 * message comes when it opens, and that menus are open to browse meanwhile. Without a saved place
 * there is no area yet: one button adds it. Checkout sends a waiting person here.
 */
export default function WaitlistPage() {
  return useSignedIn() ? <Waitlist /> : <GuestGate kind="orders" />;
}

function Waitlist() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const q = useAccess();
  const v = q.data;

  if (!v) {
    if (q.isError)
      return (
        <RetryState
          kind={retryKindFor({ net, error: q.error })}
          locale={locale}
          art={net.state !== 'online' ? <SketchScene name="offline" /> : undefined}
          onRetry={() => void q.refetch()}
        />
      );
    return (
      <Screen edges={['bottom']} testID="waitlist-loading">
        <Skeleton height={200} radius={16} />
        <Skeleton height={24} width="60%" />
        <Skeleton height={60} />
      </Screen>
    );
  }

  // Let in while this screen was open (or opened from an old link): nothing to wait for.
  if (v.state === 'open') {
    return (
      <Screen edges={['bottom']} testID="waitlist-open">
        <EmptyState
          icon="check"
          art={<SketchScene name="welcome" />}
          title={t('push.access_open.title')}
          body={t('push.access_open.body')}
          action={{ label: t('waitlist.open_action'), onPress: () => router.replace('/food') }}
        />
      </Screen>
    );
  }

  if (v.state === 'needs_place') {
    return (
      <Screen edges={['bottom']} testID="waitlist-needs-place">
        <EmptyState
          icon="map-pin"
          art={<SketchScene name="door" />}
          title={t('waitlist.needs_place_title')}
          body={t('waitlist.needs_place_body')}
          action={{ label: t('waitlist.add_place'), onPress: () => router.push('/places/new') }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      edges={['bottom']}
      testID="waitlist"
      footer={
        <Button
          testID="waitlist-browse"
          variant="secondary"
          icon="search"
          label={t('waitlist.browse')}
          fullWidth
          onPress={() => router.replace('/')}
        />
      }
    >
      <View style={{ alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: '100%', maxWidth: 280 }}>
          <SketchScene name="doorbell" />
        </View>
        <Text variant="title" align="center" accessibilityRole="header">
          {t('waitlist.title')}
        </Text>
        <Text variant="body" color="textMuted" align="center">
          {t('waitlist.body')}
        </Text>
      </View>
      <Card padding={4} tone="tint" testID="waitlist-place">
        <View style={{ gap: theme.space[2] }}>
          {v.zoneNameAr ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Icon name="map-pin" size={18} color="accentText" />
              <Text variant="bodyStrong">{t('waitlist.zone', { zone: v.zoneNameAr })}</Text>
            </View>
          ) : null}
          <Text variant="body" testID="waitlist-ahead">
            {v.ahead ? t('waitlist.ahead', { count: v.ahead }) : t('waitlist.ahead_none')}
          </Text>
        </View>
      </Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
        <Icon name="bell" size={18} color="textMuted" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('waitlist.message_hint')}
        </Text>
      </View>
      <Text variant="footnote" color="textMuted">
        {t('waitlist.browse_hint')}
      </Text>
    </Screen>
  );
}
