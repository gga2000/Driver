import { router } from 'expo-router';
import type { TripChatSubject } from '@driver/contracts';
import { Button } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { useTripChatThreads } from './trip-queries';

/**
 * «اسأل السايق» (step 4c): opens the chat with the driver of a seat run, or with one driver who offered
 * on his private car («اسأله», `withId`). Says how many messages wait unread.
 */
export function TripChatEntry({ subject, id, withId, compact = false, testID }: { subject: TripChatSubject; id: string; withId?: string; compact?: boolean; testID?: string }) {
  const t = useT();
  const threads = useTripChatThreads(subject, id);
  const mine = threads.data?.find((x) => (withId ? x.withId === withId : true));
  const unread = mine?.unread ?? 0;
  const waiting = mine?.waitingOnYou ?? 0;
  const label = t(compact ? 'chat.trip.ask_him' : 'chat.trip.ask_driver');
  return (
    <Button
      testID={testID ?? 'trip-chat-entry'}
      label={unread > 0 ? `${label} · ${t('chat.trip.unread', { count: unread })}` : waiting > 0 ? `${label} · ${t('chat.trip.waiting_you')}` : label}
      icon="chat"
      variant={unread > 0 || waiting > 0 ? 'primary' : 'secondary'}
      size={compact ? 'sm' : 'md'}
      fullWidth={!compact}
      onPress={() => router.push({ pathname: '/rajaa/chat/[subject]/[id]', params: { subject, id, ...(withId ? { with: withId } : {}) } })}
    />
  );
}
