import { Stack, useLocalSearchParams } from 'expo-router';
import { ChatThreadKind } from '@driver/contracts';
import { ChatScreen } from '@/features/chat/ChatScreen';

/** `/chat/<orderId>?kind=merchant_courier|customer_merchant` — the kitchen's conversation with the courier or the customer. */
export default function ChatRoute() {
  const { orderId = '', kind, number } = useLocalSearchParams<{ orderId: string; kind?: string; number?: string }>();
  const parsed = ChatThreadKind.safeParse(kind);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ChatScreen orderId={orderId} kind={parsed.success ? parsed.data : 'merchant_courier'} {...(number ? { orderNumber: number } : {})} />
    </>
  );
}
