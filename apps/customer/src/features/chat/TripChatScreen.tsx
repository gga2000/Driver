import { router } from 'expo-router';
import { Platform } from 'react-native';
import type { ChatMessage, TripChatSubject, TripChatView } from '@driver/contracts';
import { ChatThread, TripCard, TripDealStrip, useToast } from '@driver/ui';
import { currentFix, photoUri, pickGatePhoto, uploadPhoto } from '@/features/account/device';
import { boardDays, onDay } from '@/features/rajaa/board-filters';
import { cityName } from '@/features/rajaa/labels';
import { clockLabel } from '@/features/rajaa/logic';
import { useRespondAgreement } from '@/features/rajaa/queries';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { tripRef, useTripChatActions, useTripChatThread } from './trip-queries';
import { useChatVoice } from './useChatVoice';

/** «باچر 7:00 ص»: the trip's Baghdad day word and clock. */
function whenText(t: TFn, when: Date, now: Date): string {
  const day = boardDays(now).find((d) => onDay({ departAt: when }, d))?.id;
  const clock = clockLabel(when);
  return day ? `${t(day === 'today' ? 'rajaa.day_today' : day === 'tomorrow' ? 'rajaa.day_tomorrow' : 'rajaa.day_after')} ${clock}` : clock;
}

/** «لبغداد», «للعزيزية», «للكوفة»: ل on a name with ال drops its alif. */
function toPlace(t: TFn, place: string): string {
  return t('chat.trip.to_city', { city: place.startsWith('ال') ? place.slice(1) : place });
}

/** «للعزيزية · باچر 7:00 ص · ما حجزت بعد» / «سيارة خاصة للصويرة · …». */
export function tripSubtitle(t: TFn, v: Pick<TripChatView, 'trip'>, now: Date): string {
  const when = whenText(t, new Date(v.trip.when), now);
  if (v.trip.subject === 'request') return t('chat.trip.sub_request', { to: toPlace(t, v.trip.toLabel ?? ''), when });
  const to = toPlace(t, cityName(t, v.trip.toCityId ?? ''));
  return t('chat.trip.sub_run_rider', { to, when, booked: t(v.trip.booked ? 'chat.trip.booked_you' : 'chat.trip.not_booked_you') });
}

/**
 * The rider's Baghdad/Kut chat with one driver (private car round 2 step 4c, Ali's design way 2):
 * the shared `ChatThread`, the pinned «اللي اتفقنا عليه» strip, and the driver's prices as cards he
 * answers with «موافق / لا» right here (`routes.agreements.respond`). The card's amount is the
 * server's; an agreed price goes on his booking from there.
 */
export function TripChatScreen({ subject, id, withId }: { subject: TripChatSubject; id: string; withId?: string | null }) {
  const t = useT();
  const locale = useLocale();
  const client = useApiClient();
  const toast = useToast();
  const ref = tripRef(subject, id, withId);
  const thread = useTripChatThread(ref);
  const actions = useTripChatActions(ref);
  const respond = useRespondAgreement();
  const voice = useChatVoice(id, 'rider_driver', (input) => client.chat.trip.voiceUpload.mutate({ ...ref, ...input }));
  const v = thread.data;
  const driverName = v?.participants.find((p) => p.role === 'courier')?.name ?? t('chat.trip.driver_fallback');

  const answer = (m: ChatMessage, accept: boolean) => {
    if (!m.card) return;
    respond.mutate(
      { agreementId: m.card.refId, accept },
      {
        onSettled: () => void actions.refresh(),
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' }),
      },
    );
  };

  return (
    <ChatThread
      orderId={id}
      kind="rider_driver"
      thread={thread}
      t={t}
      locale={locale}
      send={({ orderId: _o, kind: _k, ...body }) => actions.send.mutateAsync({ ...ref, ...body })}
      markRead={(seq) => actions.markRead.mutate({ ...ref, seq })}
      refresh={actions.refresh}
      call={() => undefined}
      calling={false}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/rajaa'))}
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
      voice={voice}
      subtitle={v ? tripSubtitle(t, v, new Date()) : undefined}
      pinned={v && v.deal.length > 0 ? <TripDealStrip deal={v.deal} side="customer" t={t} /> : null}
      renderCard={(m) =>
        m.card ? (
          <TripCard
            card={m.card}
            side="customer"
            mine={m.mine}
            otherName={driverName}
            t={t}
            busy={respond.isPending && respond.variables?.agreementId === m.card.refId ? respond.variables.accept : null}
            onAnswer={m.card.kind === 'cash_reservation' ? undefined : (accept) => answer(m, accept)}
            testID={`trip-card-${m.seq}`}
          />
        ) : null
      }
      empty={{ title: t('chat.trip.empty_rider_title'), body: t('chat.trip.empty_rider_body') }}
    />
  );
}
