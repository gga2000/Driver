import { Stack, useLocalSearchParams } from 'expo-router';
import { ChatThreadKind } from '@driver/contracts';
import { ChatScreen } from '@/features/chat/ChatScreen';

/** `/chat/<orderId>?kind=customer_courier|merchant_courier` — the courier's conversation with the customer or the kitchen. */
export default function ChatRoute() {
  const { orderId = '', kind } = useLocalSearchParams<{ orderId: string; kind?: string }>();
  const parsed = ChatThreadKind.safeParse(kind);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ChatScreen orderId={orderId} kind={parsed.success ? parsed.data : 'customer_courier'} />
    </>
  );
}
