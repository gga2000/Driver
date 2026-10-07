import { router } from 'expo-router';
import { Platform } from 'react-native';
import type { ChatThreadKind } from '@driver/contracts';
import { ChatThread } from '@driver/ui';
import { currentFix, photoUri, pickGatePhoto, uploadPhoto } from '@/features/account/device';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useCourierPosition, useTracking } from '@/features/track/queries';
import { formatMinuteCount } from '@driver/i18n';
import { useNow } from '@driver/ui';
import { chatLive, orderQuickReplies } from './live-status';
import { useChatActions, useChatThread } from './queries';
import { useChatVoice } from './useChatVoice';
import { useMaskedCall } from './useMaskedCall';

/**
 * One conversation of an order (customer app spec §4 "message with quick replies, masked call"):
 * the shared `ChatThread` from @driver/ui wired to this app's API, photo picker and location, and
 * voice notes to the courier / driver and to support (ride ideas n7/n8).
 */
export function ChatScreen({ orderId, kind, orderNumber }: { orderId: string; kind: ChatThreadKind; orderNumber?: string }) {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const thread = useChatThread(orderId, kind);
  const actions = useChatActions(orderId, kind);
  const { call, busy } = useMaskedCall(orderId, kind, thread.data?.ride ?? false);
  const voice = useChatVoice(orderId, kind);
  // l7: with the courier (or driver), the header says where he is and the replies follow the moment.
  const withCourier = kind === 'customer_courier';
  const track = useTracking(withCourier ? orderId : '');
  const pos = useCourierPosition(orderId, withCourier && Boolean(track.data?.courier));
  const tick = useNow(true, 30_000);
  const live = withCourier ? chatLive(track.data, pos.data?.pin ?? null, new Date(tick)) : null;
  const liveStatus = live
    ? {
        text: live.kind === 'at_door' ? t(thread.data?.ride ? 'chat.live_at_pickup' : 'chat.live_at_door') : t('chat.live_on_the_way', { time: formatMinuteCount(live.minutes, { locale }) }),
        onPress: () => (router.canGoBack() ? router.back() : router.replace(`/order/${orderId}`)),
      }
    : null;
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
      voice={voice}
      liveStatus={liveStatus}
      orderReplies={(keys) => orderQuickReplies(keys, live)}
      // The support team needs words and photos, not his location.
      currentLocation={
        kind === 'customer_support'
          ? undefined
          : async () => {
              const fix = await currentFix();
              return fix === 'denied' || fix === null ? fix : fix.pin;
            }
      }
    />
  );
}
