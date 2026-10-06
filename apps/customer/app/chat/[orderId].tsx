import { Stack, useLocalSearchParams } from 'expo-router';
import { ChatThreadKind, orderTicketNumber } from '@driver/contracts';
import { ChatScreen } from '@/features/chat/ChatScreen';

/** `/chat/<orderId>?kind=customer_courier|customer_merchant` — one conversation of an order. */
export default function ChatRoute() {
  const { orderId = '', kind } = useLocalSearchParams<{ orderId: string; kind?: string }>();
  const parsed = ChatThreadKind.safeParse(kind);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      {/* L-12: the same ticket number as the order screen's chip. */}
      <ChatScreen orderId={orderId} kind={parsed.success ? parsed.data : 'customer_courier'} orderNumber={orderTicketNumber(orderId)} />
    </>
  );
}
