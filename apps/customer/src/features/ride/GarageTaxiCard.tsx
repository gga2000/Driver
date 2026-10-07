import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { formatWhen } from '@driver/i18n';
import { Button, formatClock, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { hasPlan, toGarageCardState, type ToGarageCardState } from './garage-taxi';
import { useBookToGarage, useToGaragePlan } from './garage-taxi-queries';
import { garageLabel, payLabel, PlaceChoice, TaxiCardShell, TaxiCardWaiting } from './GarageTaxiParts';

export interface GarageTaxiCardProps {
  /** The rider's booked seat on a car leaving an Aziziyah garage (`routes.myBookings` id). */
  bookingId: string;
  testID?: string;
}

/**
 * «تكسي يلحگك على سيارة الرجعة» (taxi idea x2), self-contained: give it the seat, it asks the server
 * for a taxi that brings him to the car's garage 10 minutes before the car's time — from home unless he
 * picks another saved place — and books it as a ride for later (or a ride now when it is that close).
 * The fare is the server's for that time. It hides for a seat the idea does not apply to (not leaving
 * Aziziyah, not booked yet, a door pickup, the car left).
 */
export function GarageTaxiCard({ bookingId, testID = 'garage-taxi-card' }: GarageTaxiCardProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const [placeId, setPlaceId] = useState<string | null>(null);
  const q = useToGaragePlan(bookingId, placeId);
  const booking = useBookToGarage(bookingId);
  const state = toGarageCardState({ data: q.data, isError: q.isError }, net.online);

  const book = async () => {
    if (state.kind !== 'offer') return;
    try {
      const out = await booking.book(state.plan);
      toast.show({ message: t(out.mode === 'later' ? 'gtaxi.to_booked_toast' : 'gtaxi.to_ordered_toast'), tone: 'success', icon: 'check' });
      if (out.mode === 'now' && out.order) router.push({ pathname: '/order/[id]', params: { id: out.order.orderId } });
    } catch (e) {
      toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
      void q.refetch();
    }
  };

  return (
    <GarageTaxiCardView
      state={state}
      now={Date.now()}
      busy={booking.busy}
      onPlace={setPlaceId}
      onBook={() => void book()}
      onRetry={() => void q.refetch()}
      onSeeRide={(orderId, later) => router.push(later ? { pathname: '/ride/booked/[id]', params: { id: orderId } } : { pathname: '/order/[id]', params: { id: orderId } })}
      onAddPlace={() => router.push({ pathname: '/places/new', params: { label: 'home' } })}
      testID={testID}
    />
  );
}

export interface GarageTaxiCardViewProps {
  state: ToGarageCardState;
  now: number;
  busy?: boolean;
  onPlace: (placeId: string) => void;
  onBook: () => void;
  onRetry: () => void;
  onSeeRide: (orderId: string, later: boolean) => void;
  onAddPlace: () => void;
  testID?: string;
}

/** The x2 card for a given state (the preview route renders each one). */
export function GarageTaxiCardView({ state, now, busy = false, onPlace, onBook, onRetry, onSeeRide, onAddPlace, testID = 'garage-taxi-card' }: GarageTaxiCardViewProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const clock = (d: Date) => formatClock(d, { locale });
  const when = (d: Date) => formatWhen(d, now, { locale });
  const title = t('gtaxi.to_title');

  if (!hasPlan(state)) return state.kind === 'hidden' ? null : <TaxiCardWaiting kind={state.kind} title={title} icon="taxi" onRetry={onRetry} testID={testID} />;

  const { plan, offline } = state;
  const garage = garageLabel(plan.garage.nameAr);
  const offlineNote = offline ? (
    <Text variant="caption" color="textMuted">
      {t('gtaxi.offline')}
    </Text>
  ) : null;

  if (state.kind === 'no_place') {
    return (
      <TaxiCardShell icon="taxi" title={title} testID={testID}>
        <Text variant="body" color="textMuted">
          {t('gtaxi.no_place_title')}
        </Text>
        <Button testID={`${testID}-add-place`} variant="secondary" icon="home" label={t('gtaxi.no_place_button')} fullWidth disabled={offline} onPress={onAddPlace} />
      </TaxiCardShell>
    );
  }

  if (state.kind === 'too_late') {
    return (
      <TaxiCardShell icon="taxi" title={title} testID={testID}>
        <Text variant="body" color="textMuted" testID={`${testID}-too-late`}>
          {t('gtaxi.to_too_late', { garage, depart: clock(plan.departAt) })}
        </Text>
      </TaxiCardShell>
    );
  }

  if (state.kind === 'booked') {
    const later = plan.mode === 'later';
    const place = plan.fromName ?? '';
    return (
      <TaxiCardShell icon="taxi" title={t('gtaxi.to_booked_title')} pill={{ label: t('gtaxi.status_booked'), tone: 'success', icon: 'check' }} tone="tint" testID={testID}>
        <Text variant="body" testID={`${testID}-booked`}>
          {later && plan.pickupAt ? t('gtaxi.to_booked_body', { time: when(plan.pickupAt), place, garage }) : t('gtaxi.to_booked_body_now', { place, garage })}
        </Text>
        {plan.order ? <Button testID={`${testID}-see`} variant="secondary" icon="chevron-back" label={t('gtaxi.to_see_ride')} fullWidth onPress={() => onSeeRide(plan.order!.orderId, later && plan.order!.state === 'placed')} /> : null}
        {offlineNote}
      </TaxiCardShell>
    );
  }

  const place = plan.fromName ?? '';
  const amount = plan.totalIqd !== null ? amountParam(plan.totalIqd) : '';
  const later = plan.mode === 'later' && plan.pickupAt !== null && plan.arriveAt !== null;
  // The pickup sits on the 5-minute grid, so he is often there a little more than the 10 minutes early: say how much.
  const body = later
    ? t('gtaxi.to_body_later', { time: when(plan.pickupAt!), place, garage, arrive: clock(plan.arriveAt!), buffer: Math.max(plan.bufferMin, Math.round((plan.departAt.getTime() - plan.arriveAt!.getTime()) / 60_000)) })
    : t('gtaxi.to_body_now', { place, garage, arrive: plan.arriveAt ? clock(plan.arriveAt) : '', depart: clock(plan.departAt) });
  return (
    <TaxiCardShell icon="taxi" title={title} testID={testID}>
      <Text variant="body" testID={`${testID}-body`}>
        {body}
      </Text>
      <PlaceChoice label={t('gtaxi.from_label')} places={plan.places} value={plan.fromPlaceId} onChange={onPlace} disabled={offline || busy} />
      <Text variant="caption" color="textMuted" tabular testID={`${testID}-meta`}>
        {t('gtaxi.to_meta', { minutes: plan.rideMin ?? 0, amount, pay: payLabel(t, plan.paymentMethod) })}
      </Text>
      <View style={{ gap: theme.space[1] }}>
        <Button
          testID={`${testID}-book`}
          icon="taxi"
          label={later ? t('gtaxi.to_book_later', { time: when(plan.pickupAt!) }) : t('gtaxi.to_book_now')}
          trailing={amount ? t('habits.amount', { amount }) : undefined}
          loading={busy}
          disabled={offline}
          fullWidth
          onPress={onBook}
        />
        <Text variant="caption" color="successText" align="center">
          {t('gtaxi.to_free_cancel')}
        </Text>
      </View>
      {offlineNote}
    </TaxiCardShell>
  );
}
