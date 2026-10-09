import { Stack, useLocalSearchParams } from 'expo-router';
import { TripChatSubject } from '@driver/contracts';
import { TripChatScreen } from '@/features/chat/TripChatScreen';

/**
 * `/intercity/chat/departure/<runId>?with=<riderId>` (a rider on his run) or `/intercity/chat/request/<requestId>`
 * (the rider of a private car he offered on): the Baghdad/Kut chat, step 4c.
 */
export default function TripChatRoute() {
  const { subject, id = '', with: withId } = useLocalSearchParams<{ subject: string; id: string; with?: string }>();
  const parsed = TripChatSubject.safeParse(subject);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <TripChatScreen subject={parsed.success ? parsed.data : 'departure'} id={id} withId={withId ?? null} />
    </>
  );
}
