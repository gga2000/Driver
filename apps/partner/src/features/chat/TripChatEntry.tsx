import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { TripChatSubject } from '@driver/contracts';
import { Avatar, Button, Icon, Rule, StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useTripChatThreads } from './trip-queries';

const open = (subject: TripChatSubject, id: string, withId?: string) =>
  router.push({ pathname: '/intercity/chat/[subject]/[id]', params: { subject, id, ...(withId ? { with: withId } : {}) } });

/** «راسله» (step 4c): the chat with the rider of a private car he offered on, with its unread count. */
export function RequestChatEntry({ id, testID = 'trip-chat-entry' }: { id: string; testID?: string }) {
  const t = useT();
  const threads = useTripChatThreads('request', id);
  const unread = threads.data?.[0]?.unread ?? 0;
  const label = t('chat.trip.message_rider');
  return (
    <Button
      testID={testID}
      label={unread > 0 ? `${label} · ${t('chat.trip.unread', { count: unread })}` : label}
      icon="chat"
      variant={unread > 0 ? 'primary' : 'secondary'}
      fullWidth
      onPress={() => open('request', id)}
    />
  );
}

/**
 * «رسائل الركاب» (step 4c): the riders of his run who wrote, asked for a price or booked, newest message
 * first, with what waits on him. Nothing shows until there is something to read.
 */
export function RunChats({ id, testID = 'trip-chats' }: { id: string; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const threads = useTripChatThreads('departure', id);
  const rows = (threads.data ?? []).filter((x) => x.lastMessageAt !== null);
  if (rows.length === 0) return null;
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={700}>
        {t('chat.trip.threads_title')}
      </Text>
      <View style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, paddingHorizontal: theme.space[4] }}>
        {rows.map((r, i) => {
          const name = r.withName ?? t('chat.trip.rider_fallback');
          return (
            <View key={r.withId}>
              {i > 0 ? <Rule /> : null}
              <Pressable
                testID={`${testID}-${r.withId}`}
                accessibilityRole="button"
                accessibilityLabel={name}
                onPress={() => open('departure', id, r.withId)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 60, paddingVertical: theme.space[2] }}
              >
                <Avatar name={name} size={40} />
                <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                  {name}
                </Text>
                {r.waitingOnYou > 0 ? <StatusPill size="sm" tone="accent" icon="cash" label={t('chat.trip.deal.wait_you')} /> : null}
                {r.unread > 0 ? <StatusPill size="sm" tone="info" label={t('chat.trip.unread', { count: r.unread })} /> : null}
                <Icon name="chevron-forward" size={18} color="textMuted" />
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}
