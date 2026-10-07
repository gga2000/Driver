import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Badge, formatClock, Icon, Text, useTheme } from '@driver/ui';
import { useApi } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/** How often home re-reads the reopened chats (a push also arrives with the rider's line). */
const LOST_ITEMS_POLL_MS = 60_000;

/** Whether a time falls on a later Baghdad day than now ("لحد باجر 6:28 ص" rather than a bare clock). */
export function laterBaghdadDay(at: Date, now: number): boolean {
  const day = (ms: number) => Math.floor((ms + 3 * 3_600_000) / 86_400_000);
  return day(at.getTime()) > day(now);
}

/**
 * s7 «نسيت غرض» (ride step 3): a rider reopened the chat of a finished ride to find something he left
 * in the car. One strip per open chat on home, until the chat closes again (the ride's end + 24 h):
 * the driver checks the car and answers there.
 */
export function LostItemStrips() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const api = useApi();
  const signedIn = useSignedIn();
  const asks = useQuery({ ...api.chat.lostItems.queryOptions(), enabled: signedIn, refetchInterval: LOST_ITEMS_POLL_MS, retry: false });
  if (!asks.data || asks.data.length === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      {asks.data.map((a) => (
        <Pressable
          key={a.threadId}
          testID={`lost-item-${a.orderId}`}
          accessibilityRole="button"
          accessibilityHint={t('partner.lost_item_open')}
          onPress={() => router.push({ pathname: '/chat/[orderId]', params: { orderId: a.orderId, kind: 'customer_courier' } })}
          style={({ pressed }) => ({
            minHeight: 56,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[3],
            padding: theme.space[3],
            borderRadius: theme.radius.lg,
            backgroundColor: pressed ? theme.colors.border : theme.colors.accentTint,
          })}
        >
          <Icon name="bag" size={20} color="accentText" />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="label" weight={700}>
              {t('partner.lost_item_title')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t(laterBaghdadDay(a.openUntil, Date.now()) ? 'partner.lost_item_body_tomorrow' : 'partner.lost_item_body', { time: formatClock(a.openUntil, { period: true, locale }) })}
            </Text>
          </View>
          {a.unread > 0 ? <Badge count={a.unread} /> : null}
          <Icon name="chevron-forward" size={18} color="textMuted" />
        </Pressable>
      ))}
    </View>
  );
}
