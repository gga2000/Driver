import { router } from 'expo-router';
import { Platform } from 'react-native';
import type { ChatThreadKind } from '@driver/contracts';
import { ChatThread } from '@driver/ui';
import { currentFix, photoUri, pickGatePhoto, uploadPhoto } from '@/features/account/device';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useChatActions, useChatThread } from './queries';
import { useMaskedCall } from './useMaskedCall';

/**
 * One conversation of an order (customer app spec §4 "message with quick replies, masked call"):
 * the shared `ChatThread` from @driver/ui wired to this app's API, photo picker and location.
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
      onBack={() => (router.canGoBack() ? router.back() : router.replace(`/order/${orderId}`))}
      errorMessage={(err, fallback) => apiErrorMessage(err, fallback, locale)}
      errorCode={apiErrorCode}
      photoUri={photoUri}
      attachPhoto={async () => {
        const picked = await pickGatePhoto(Platform.OS === 'web' ? 'library' : 'camera');
        if (picked === 'denied' || !picked) return picked;
        const uploadId = await uploadPhoto(picked, (input) => client.places.photoUpload.mutate(input));
        return { uploadId, localUri: picked.uri };
      }}
      currentLocation={async () => {
        const fix = await currentFix();
        return fix === 'denied' || fix === null ? fix : fix.pin;
      }}
    />
  );
}
