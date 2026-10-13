import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { MessageKey } from '@driver/i18n';
import type { ParcelState, ParcelView } from '@driver/contracts';
import { Button, formatClock, Icon, QueryBoundary, Screen, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { canCancel, isLive } from '@/features/parcel/logic';
import { parcelSwatch } from '@/features/parcel/palette';
import { ParcelButton } from '@/features/parcel/ParcelButton';
import { ParcelTag } from '@/features/parcel/ParcelTag';
import { ApiPhoto, Note, ProofPhoto, TopBar, WashChip } from '@/features/parcel/Parts';
import { rememberedDoorLink, useParcel, useParcelCache } from '@/features/parcel/queries';
import { ShareDoorLink } from '@/features/parcel/ShareDoorLink';
import { StepsStrip } from '@/features/parcel/StepsStrip';
import { BottomPanel } from '@/features/track/Panels';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

const CHIP: Record<ParcelState, MessageKey> = {
  waiting_door: 'parcel.c_step_sent',
  finding_courier: 'parcel.c_step_door_set',
  to_pickup: 'parcel.c_step_door_set',
  on_the_way: 'track.kitchen_picked_up_any',
  delivered: 'orders.short.delivered',
  returning: 'parcel.c_state_returning',
  returned: 'parcel.c_state_returned',
  cancelled: 'parcel.c_state_cancelled',
};

/**
 * The parcel's page (concepts B1 tag, A3 live, B2 delivered; Ali 2026-10-12). The kraft tag carries from → to,
 * what and its size, its value and what we make good, and the receipt code as a henna wax seal the sender may
 * pass on; the strip under it carries the four moments with their real times. Above the tag, the one thing
 * happening now: waiting for the receiver's door (with the link to send again and when it lapses), a courier
 * on it (the live map is the order's own screen), delivered with the door photo, coming back, or cancelled.
 */
export default function ParcelPage() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const q = useParcel(id);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/orders'));
  const p = q.data;

  if (!p) {
    return (
      <Screen testID="parcel-page" contentStyle={{ flexGrow: 1 }}>
        <TopBar title={t('parcel.c_page_title')} backLabel={t('action.back')} onBack={back} />
        <QueryBoundary
          query={q}
          locale={locale}
          testID="parcel-state"
          gone={{ icon: 'parcel', title: t('error.parcel_not_found'), action: { label: t('nav.orders'), onPress: () => router.replace('/orders') } }}
          skeleton={
            <View style={{ gap: theme.space[4] }}>
              <Skeleton width="70%" height={28} />
              <Skeleton height={220} radius={28} />
              <Skeleton lines={2} />
            </View>
          }
        >
          {() => null}
        </QueryBoundary>
      </Screen>
    );
  }
  return <Loaded p={p} back={back} />;
}

function Loaded({ p, back }: { p: ParcelView; back: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const putView = useParcelCache();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const name = p.recipientName || t('parcel.recipient');
  const facts = {
    from: [p.senderName, p.fromLabel].filter(Boolean).join('، '),
    to: [p.recipientName, p.toLabel].filter(Boolean).join('، '),
    what: p.what,
    size: p.size,
    declaredValueIqd: p.declaredValueIqd,
    coveredIqd: p.coveredIqd,
    pin: p.state === 'delivered' || p.state === 'cancelled' || p.state === 'returned' ? null : p.pin,
  };

  const newLink = async (): Promise<string | null> => {
    try {
      const view = await client.parcels.newDoorLink.mutate({ parcelId: p.id });
      putView(view);
      return view.doorLink;
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
      return null;
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      const view = await client.parcels.cancel.mutate({ parcelId: p.id });
      putView(view);
      setCancelOpen(false);
      toast.show({ message: t('parcel.c_state_cancelled'), tone: 'neutral', icon: 'parcel' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' });
    } finally {
      setCancelling(false);
    }
  };

  const sendAgain = () => router.replace({ pathname: '/parcel', params: p.recipientName ? { for: p.recipientName } : {} });
  const fareLine = t(p.payer === 'sender' ? 'parcel.c_fare_sender' : 'parcel.c_fare_receiver', { amount: amountParam(p.fareIqd) });
  const delivered = p.state === 'delivered';

  return (
    <View style={{ flex: 1 }}>
      <Screen
        testID="parcel-page"
        footer={
          delivered || p.state === 'cancelled' || p.state === 'returned' ? (
            <ParcelButton label={t('parcel.c_send_again')} tone="ink" onPress={sendAgain} testID="parcel-send-again" />
          ) : isLive(p.state) && p.orderId ? (
            <ParcelButton label={t('parcel.c_track')} icon="map-pin" onPress={() => router.push({ pathname: '/order/[id]', params: { id: p.orderId! } })} testID="parcel-track" />
          ) : undefined
        }
      >
        <TopBar title={t('parcel.c_page_title')} backLabel={t('action.back')} onBack={back} end={<WashChip label={t(CHIP[p.state])} testID="parcel-chip" />} />

        {delivered ? <DeliveredHero p={p} name={name} /> : <Headline p={p} name={name} />}

        {p.state === 'waiting_door' && p.doorBy === 'receiver' ? <ShareDoorLink name={name} what={p.what} link={p.doorLink ?? rememberedDoorLink(p.id)} getLink={newLink} /> : null}

        <ParcelTag facts={facts} />
        {facts.pin ? <Note icon="lock" tone="henna" testID="parcel-pin-note">{t('parcel.c_seal_hint')}</Note> : null}

        <StepsStrip steps={p.steps} state={p.state} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="cash" size={18} color="textMuted" />
          <Text variant="label" color="textMuted" style={{ flex: 1 }} testID="parcel-fare">
            {fareLine}
          </Text>
        </View>

        {p.pickupPhotoUrl ? <ProofPhoto url={p.pickupPhotoUrl} title={t('parcel.c_photo_pickup')} sub={t('parcel.c_photo_pickup_sub')} testID="parcel-photo-pickup" /> : null}
        {!delivered && !p.pickupPhotoUrl && p.photoUrl ? (
          <View style={{ borderRadius: theme.radius['2xl'], overflow: 'hidden' }}>
            <ApiPhoto url={p.photoUrl} label={t('parcel.c_photo_item')} style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: theme.colors.surfaceSunken }} testID="parcel-photo-item" />
          </View>
        ) : null}

        {canCancel(p.state) ? <Button label={t('parcel.c_cancel')} icon="x" variant="ghost" fullWidth onPress={() => setCancelOpen(true)} testID="parcel-cancel" /> : null}
      </Screen>

      {cancelOpen ? (
        <BottomPanel onClose={() => setCancelOpen(false)} testID="parcel-cancel-sheet">
          <Text variant="heading">{t('parcel.c_cancel_title')}</Text>
          <Text variant="body" color="textMuted">
            {t(p.state === 'waiting_door' ? 'parcel.c_cancel_body_waiting' : 'parcel.c_cancel_body_finding')}
          </Text>
          <Button label={t('orders.booked_cancel_yes')} variant="destructive" fullWidth loading={cancelling} onPress={() => void cancel()} testID="parcel-cancel-yes" />
          <Button label={t('parcel.c_cancel_keep')} variant="secondary" fullWidth onPress={() => setCancelOpen(false)} testID="parcel-cancel-keep" />
        </BottomPanel>
      ) : null}
    </View>
  );
}

/** What is happening now, in one heading and one line. */
function Headline({ p, name }: { p: ParcelView; name: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [title, body]: [string, string | null] = (() => {
    switch (p.state) {
      case 'waiting_door':
        return [t('parcel.c_state_waiting', { name }), p.doorDueAt ? t('parcel.c_state_waiting_body', { time: formatClock(p.doorDueAt, { locale }) }) : null];
      case 'finding_courier':
        return [t('parcel.c_state_finding'), t('parcel.pin_sender_hint')];
      case 'to_pickup':
        return [t('parcel.c_state_to_pickup'), t('parcel.pin_sender_hint')];
      case 'on_the_way':
        return [t('parcel.c_state_on_the_way', { name }), t('parcel.c_state_live_body')];
      case 'returning':
        return [t('parcel.c_state_returning'), t('parcel.c_state_returning_body')];
      case 'returned':
        return [t('parcel.c_state_returned'), null];
      case 'cancelled':
        return [t('parcel.c_state_cancelled'), t('parcel.c_state_cancelled_body')];
      default:
        return [t('parcel.c_state_delivered'), null];
    }
  })();
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(200)} style={{ gap: theme.space[1] }} testID={`parcel-state-${p.state}`}>
      <Text variant="display" accessibilityRole="header" style={{ fontSize: 26, lineHeight: 38 }}>
        {title}
      </Text>
      {body ? (
        <Text variant="body" color={p.state === 'returning' ? 'warningText' : 'textMuted'}>
          {body}
        </Text>
      ) : null}
    </Animated.View>
  );
}

/** «وصلت الأمانة» (concept B2): the door photo, when the courier took one, as the moment's picture. */
function DeliveredHero({ p, name }: { p: ParcelView; name: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const sw = parcelSwatch(theme);
  const at = p.steps.find((s) => s.key === 'delivered')?.at ?? null;
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(320)} style={{ gap: theme.space[3] }} testID="parcel-delivered">
      {p.dropoffPhotoUrl ? (
        <View style={{ borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
          <ApiPhoto url={p.dropoffPhotoUrl} label={t('parcel.c_photo_dropoff')} style={{ width: '100%', aspectRatio: 4 / 3 }} testID="parcel-photo-dropoff" />
          <View style={{ position: 'absolute', bottom: theme.space[3], start: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[3], minHeight: 36, borderRadius: theme.radius.pill, backgroundColor: sw.fill }}>
            <Icon name="lock" size={16} color={sw.on} strokeWidth={2.2} />
            <Text variant="label" weight={700} color={sw.on}>
              {t('parcel.c_photo_dropoff')}
            </Text>
            {at ? (
              <Text variant="label" color={sw.on} tabular>
                {` · ${formatClock(at, { locale })}`}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={{ gap: theme.space[1] }}>
        <Text variant="display" accessibilityRole="header" style={{ fontSize: 30, lineHeight: 44 }}>
          {t('parcel.c_state_delivered')}
        </Text>
        <Text variant="body" color="textMuted">
          {t('parcel.c_state_delivered_body', { what: p.what, name })}
        </Text>
      </View>
    </Animated.View>
  );
}
