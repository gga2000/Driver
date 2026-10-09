import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import type { AgreementView, ChatMessage, TripChatSubject, TripChatView } from '@driver/contracts';
import { ChatThread, Chip, IconButton, ModalSheet, Text, TripCard, TripDealStrip, tripCardTitle, useTheme, useToast } from '@driver/ui';
import { absoluteUrl, pickPhoto, uploadPhoto } from '@/features/account/photo';
import { PriceSheet } from '@/features/intercity/AgreeParts';
import { cityName, whenLabel } from '@/features/intercity/labels';
import { useDepartureAgreements, useDriverActions, useRequestActions } from '@/features/intercity/queries';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT, type TFn } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { tripRef, useTripChatActions, useTripChatThread } from './trip-queries';
import { useChatVoice } from './useChatVoice';

/** «لبغداد», «للعزيزية», «للكوفة»: ل on a name with ال drops its alif. */
function toPlace(t: TFn, place: string): string {
  return t('chat.trip.to_city', { city: place.startsWith('ال') ? place.slice(1) : place });
}

/** «راكب بغداد · باچر الساعة 7:00 الصبح · ما حجز بعد» / «سيارة خاصة للصويرة · …». */
export function tripSubtitle(t: TFn, v: Pick<TripChatView, 'trip'>, now: Date): string {
  const when = whenLabel(t, new Date(v.trip.when), now);
  if (v.trip.subject === 'request') return t('chat.trip.sub_request', { to: toPlace(t, v.trip.toLabel ?? ''), when });
  return t('chat.trip.sub_run_driver', { city: cityName(t, v.trip.toCityId ?? ''), when, booked: t(v.trip.booked ? 'chat.trip.booked_them' : 'chat.trip.not_booked_them') });
}

/**
 * The driver's Baghdad/Kut chat with one rider (private car round 2 step 4c, Ali's design way 2): the
 * shared `ChatThread`, the pinned «اللي اتفقنا عليه» strip, and the price cards. An ask from the rider
 * is priced from its card or from «اقترح سعر» beside the composer (the same sheet as the run's
 * «طلبات سعر»); a «احجز وادفع كاش» ask is answered on its card.
 */
export function TripChatScreen({ subject, id, withId }: { subject: TripChatSubject; id: string; withId?: string | null }) {
  const t = useT();
  const theme = useTheme();
  const locale = useLocale();
  const client = useApiClient();
  const toast = useToast();
  const ref = tripRef(subject, id, withId);
  const thread = useTripChatThread(ref);
  const actions = useTripChatActions(ref);
  const driver = useDriverActions();
  const request = useRequestActions();
  const voice = useChatVoice(id, 'rider_driver', (input) => client.chat.trip.voiceUpload.mutate({ ...ref, ...input }));
  const v = thread.data;
  const riderId = v?.subject === 'departure' ? v.partyId : null;
  const runOpen = v?.status === 'open' && subject === 'departure';
  // His run's asks from this rider (the price sheet works on the agreement itself).
  const agreements = useDepartureAgreements(subject === 'departure' ? id : '', runOpen);
  const fromRider = (agreements.data ?? []).filter((a) => a.riderId === riderId);
  const openAsks = fromRider.filter((a) => a.state === 'asked' || a.state === 'proposed');
  const riderName = v?.participants.find((p) => p.role === 'customer')?.name ?? t('chat.trip.rider_fallback');
  const [pricing, setPricing] = useState<AgreementView | null>(null);
  const [choosing, setChoosing] = useState(false);

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'warning' });

  const priceFromComposer = () => {
    if (openAsks.length === 0) {
      toast.show({ message: t('chat.trip.propose_none'), tone: 'info', icon: 'cash' }, 6000);
      return;
    }
    driver.propose.reset();
    if (openAsks.length === 1) setPricing(openAsks[0]!);
    else setChoosing(true);
  };

  const propose = (amountIqd: number) => {
    if (!pricing) return;
    driver.propose.mutate(
      { agreementId: pricing.id, amountIqd },
      {
        onSuccess: () => {
          theme.haptic('success');
          setPricing(null);
          void agreements.refetch();
          void actions.refresh();
        },
      },
    );
  };

  const answerCash = (m: ChatMessage, accept: boolean) => {
    if (!m.card) return;
    request.answerCash.mutate(
      { postId: id, offerId: m.card.refId, accept },
      { onSuccess: () => theme.haptic(accept ? 'success' : 'selection'), onError: fail, onSettled: () => void actions.refresh() },
    );
  };

  return (
    <>
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
        wrapQuickReplies
        onBack={() => (router.canGoBack() ? router.back() : router.replace(subject === 'departure' ? `/intercity/departure/${id}` : `/intercity/request/${id}`))}
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
        subtitle={v ? tripSubtitle(t, v, new Date()) : undefined}
        pinned={v && v.deal.length > 0 ? <TripDealStrip deal={v.deal} side="courier" t={t} /> : null}
        composerStart={
          runOpen ? (
            <IconButton icon="cash" variant={openAsks.some((a) => a.state === 'asked') ? 'accent' : 'plain'} accessibilityLabel={t('chat.trip.price_cta')} onPress={priceFromComposer} testID="trip-chat-price" />
          ) : null
        }
        renderCard={(m) => {
          if (!m.card) return null;
          const card = m.card;
          const ask = card.kind === 'cash_reservation' ? null : (fromRider.find((a) => a.id === card.refId) ?? null);
          return (
            <TripCard
              card={card}
              side="courier"
              mine={m.mine}
              otherName={riderName}
              t={t}
              busy={request.answerCash.isPending && request.answerCash.variables?.offerId === card.refId ? request.answerCash.variables.accept : null}
              onAnswer={card.kind === 'cash_reservation' ? (accept) => answerCash(m, accept) : undefined}
              onPrice={
                ask
                  ? () => {
                      driver.propose.reset();
                      setPricing(ask);
                    }
                  : undefined
              }
              testID={`trip-card-${m.seq}`}
            />
          );
        }}
        empty={{ title: t('chat.trip.empty_driver_title'), body: t('chat.trip.empty_driver_body') }}
      />
      <ModalSheet visible={choosing} onClose={() => setChoosing(false)} title={t('chat.trip.propose_title', { name: riderName })} subtitle={t('chat.trip.propose_pick')} testID="trip-chat-choose">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {openAsks.map((a) => (
            <Chip
              key={a.id}
              testID={`trip-chat-choose-${a.kind}`}
              role="button"
              icon={a.kind === 'pin_pickup' ? 'map-pin' : 'home'}
              label={tripCardTitle(t, a.kind, 'courier')}
              onPress={() => {
                setChoosing(false);
                setPricing(a);
              }}
            />
          ))}
        </View>
        {openAsks.length === 0 ? (
          <Text variant="footnote" color="textMuted">
            {t('chat.trip.propose_none')}
          </Text>
        ) : null}
      </ModalSheet>
      <PriceSheet
        ask={pricing}
        busy={driver.propose.isPending}
        error={driver.propose.isError ? apiErrorMessage(driver.propose.error, t('error.network'), locale) : null}
        onClose={() => setPricing(null)}
        onSend={propose}
      />
    </>
  );
}
