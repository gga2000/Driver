import { router } from 'expo-router';
import { Platform } from 'react-native';
import type { ChatThreadKind } from '@driver/contracts';
import { ChatThread, useToast } from '@driver/ui';
import { absoluteUrl, pickPhoto, uploadPhoto } from '@/features/account/photo';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { railStage, stepReplies } from '@/features/work/job-steps';
import { isRide } from '@/features/work/logic';
import { useActiveJob } from '@/features/work/queries';
import { CALLS_LIVE } from './calls';
import { useChatActions, useChatThread } from './queries';
import { useChatVoice } from './useChatVoice';
import { useMaskedCall } from './useMaskedCall';

/**
 * One conversation of a job, for the courier / driver (partner spec "quick contact"): the shared
 * `ChatThread` from @driver/ui wired to this app's API, camera and location, and voice notes with the
 * customer (ride ideas n7/n8; not in the kitchen's thread).
 */
export function ChatScreen({ orderId, kind, orderNumber }: { orderId: string; kind: ChatThreadKind; orderNumber?: string }) {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const thread = useChatThread(orderId, kind);
  const actions = useChatActions(orderId, kind);
  const { call, busy } = useMaskedCall(orderId, kind, thread.data?.ride ?? false);
  const voice = useChatVoice(orderId, kind);
  const toast = useToast();
  // r5 / b11: the one-tap messages that are true at his step on this order, at most three, wrapped.
  const job = useActiveJob().data;
  const mine = job?.stops.find((s) => s.stopId === job.currentStopId && s.orderId === orderId) ?? null;
  const stage = mine ? railStage(mine) : null;
  const ride = job ? isRide(job.vertical) : (thread.data?.ride ?? false);
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
      // G0-10 «Chat first»: the call shows greyed «قريباً»; a tap says the chat is the way for now.
      call={() => (CALLS_LIVE ? void call() : toast.show({ message: t('partner.call_soon_toast'), tone: 'info', icon: 'chat' }))}
      calling={busy}
      orderReplies={(keys) => stepReplies(keys, kind, ride, stage)}
      wrapQuickReplies
      callSoon={CALLS_LIVE ? undefined : t('soon.badge')}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/job'))}
      errorMessage={(err, fallback) => apiErrorMessage(err, fallback, locale)}
      errorCode={apiErrorCode}
      photoUri={(url) => absoluteUrl(url)}
      attachPhoto={async () => {
        const picked = await pickPhoto(Platform.OS === 'web' ? 'library' : 'camera');
        if (picked === 'denied' || !picked) return picked;
        const uploadId = await uploadPhoto(picked, (input) => client.places.photoUpload.mutate(input));
        return { uploadId, localUri: picked.uri };
      }}
      voice={voice}
      currentLocation={async () => {
        const fix = await currentFix();
        return fix ? { lat: fix.lat, lng: fix.lng } : null;
      }}
    />
  );
}
