import { router } from 'expo-router';
import { Platform } from 'react-native';
import type { ChatThreadKind } from '@driver/contracts';
import { ChatThread } from '@driver/ui';
import { absoluteUrl, pickPhotos, uploadPhoto } from '@/features/menu/photo';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useChatActions, useChatThread } from './queries';
import { useMaskedCall } from './useMaskedCall';

/**
 * One conversation of an order for the kitchen (with the courier, or the customer about the
 * order): the shared `ChatThread` from @driver/ui, minus sending a location.
 */
export function ChatScreen({ orderId, kind, orderNumber }: { orderId: string; kind: ChatThreadKind; orderNumber?: string }) {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const thread = useChatThread(orderId, kind);
  const actions = useChatActions(orderId, kind);
  const { call, busy } = useMaskedCall(orderId, kind, thread.data?.ride ?? false);
  return (
    <ChatThread
      orderId={orderId}
      kind={kind}
      orderNumber={orderNumber}
      thread={thread}
      t={t}
      locale={locale}
      send={(input) => actions.send.mutateAsync(input)}
      markRead={(seq) => actions.markRead.mutate({ orderId, kind, seq })}
      refresh={actions.refresh}
      call={() => void call()}
      calling={busy}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      errorMessage={(err, fallback) => apiErrorMessage(err, fallback, locale)}
      errorCode={apiErrorCode}
      photoUri={absoluteUrl}
      attachPhoto={async () => {
        const list = await pickPhotos(Platform.OS === 'web' ? 'library' : 'camera');
        const picked = list === 'denied' ? 'denied' : (list?.[0] ?? null);
        if (picked === 'denied' || !picked) return picked;
        const uploadId = await uploadPhoto(picked, (input) => client.places.photoUpload.mutate(input));
        return { uploadId, localUri: picked.uri };
      }}
    />
  );
}
