import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { armCardState, hasView, type ArmCardState } from './garage-taxi';
import { useArmGarageTaxi, useGarageArm } from './garage-taxi-queries';
import { rideStore } from './store';
import { garageLabel, payLabel, PlaceChoice, TaxiCardShell, TaxiCardWaiting } from './GarageTaxiParts';

export interface ArmedRideCardProps {
  /** The rider's booked (or boarded) seat on a car coming back to Aziziyah (`routes.myBookings` id). */
  bookingId: string;
  testID?: string;
}

/**
 * «نخلي تكسي ينتظرك؟» (taxi ideas x4 + n10), self-contained: give it the seat on a trip back to
 * Aziziyah. He arms a taxi to one of his saved places (home first); when the car is about ten minutes
 * from the Aziziyah garage the server orders it, so the driver is there when he gets down. It shows
 * today's estimate and says it is priced when ordered; disarming is free until then. It hides for a
 * seat the idea does not apply to (leaving Aziziyah, not booked, the car already arrived).
 */
export function ArmedRideCard({ bookingId, testID = 'armed-ride-card' }: ArmedRideCardProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const q = useGarageArm(bookingId);
  const m = useArmGarageTaxi(bookingId);
  const state = armCardState({ data: q.data, isError: q.isError }, net.online);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const server = hasView(state) ? state.view.toPlaceId : null;
  useEffect(() => {
    if (placeId === null && server) setPlaceId(server);
  }, [placeId, server]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.show({ message: done, tone: 'success', icon: 'check' });
    } catch (e) {
      toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
      void q.refetch();
    }
  };

  return (
    <ArmedRideCardView
      state={state}
      placeId={placeId ?? server}
      busy={m.busy}
      onPlace={(id) => {
        setPlaceId(id);
        // Armed already: the new place goes to the server at once.
        if (state.kind === 'armed') void act(() => m.arm(id), t('gtaxi.armed_toast'));
      }}
      onArm={() => {
        const id = placeId ?? server;
        if (id) void act(() => m.arm(id), t('gtaxi.armed_toast'));
      }}
      onDisarm={() => void act(() => m.disarm(), t('gtaxi.disarmed_toast'))}
      onRetry={() => void q.refetch()}
      onSeeTaxi={(orderId) => router.push({ pathname: '/order/[id]', params: { id: orderId } })}
      onOrderSelf={() => {
        rideStore.start('taxi');
        router.push('/ride');
      }}
      onAddPlace={() => router.push({ pathname: '/places/new', params: { label: 'home' } })}
      testID={testID}
    />
  );
}

export interface ArmedRideCardViewProps {
  state: ArmCardState;
  placeId: string | null;
  busy?: boolean;
  onPlace: (placeId: string) => void;
  onArm: () => void;
  onDisarm: () => void;
  onRetry: () => void;
  onSeeTaxi: (orderId: string) => void;
  onOrderSelf: () => void;
  onAddPlace: () => void;
  testID?: string;
}

/** The x4 card for a given state (the preview route renders each one). */
export function ArmedRideCardView({ state, placeId, busy = false, onPlace, onArm, onDisarm, onRetry, onSeeTaxi, onOrderSelf, onAddPlace, testID = 'armed-ride-card' }: ArmedRideCardViewProps) {
  const theme = useTheme();
  const t = useT();
  const title = t('gtaxi.arm_title');

  if (!hasView(state)) return state.kind === 'hidden' ? null : <TaxiCardWaiting kind={state.kind} title={title} icon="garage" onRetry={onRetry} testID={testID} />;

  const { view, offline } = state;
  const garage = view.garage ? garageLabel(view.garage.nameAr) : '';
  const chosen = view.places.find((p) => p.id === placeId) ?? view.places.find((p) => p.id === view.toPlaceId) ?? null;
  const place = chosen?.name ?? view.toName ?? '';
  const pay = payLabel(t, view.paymentMethod);
  const offlineNote = offline ? (
    <Text variant="caption" color="textMuted">
      {t('gtaxi.offline')}
    </Text>
  ) : null;

  if (state.kind === 'no_place') {
    return (
      <TaxiCardShell icon="garage" title={title} testID={testID}>
        <Text variant="body" color="textMuted">
          {t('gtaxi.no_place_title')}
        </Text>
        <Button testID={`${testID}-add-place`} variant="secondary" icon="home" label={t('gtaxi.no_place_button')} fullWidth disabled={offline} onPress={onAddPlace} />
      </TaxiCardShell>
    );
  }

  if (state.kind === 'placed') {
    return (
      <TaxiCardShell icon="taxi" title={t('gtaxi.placed_title')} pill={{ label: t('gtaxi.status_booked'), tone: 'success', icon: 'check' }} tone="tint" testID={testID}>
        <Text variant="body">{t('gtaxi.placed_body', { garage })}</Text>
        {view.orderId ? <Button testID={`${testID}-see`} variant="secondary" icon="chevron-back" label={t('gtaxi.placed_see')} fullWidth onPress={() => onSeeTaxi(view.orderId!)} /> : null}
      </TaxiCardShell>
    );
  }

  if (state.kind === 'dropped') {
    return (
      <TaxiCardShell icon="garage" title={title} testID={testID}>
        <Text variant="body" color="textMuted" testID={`${testID}-dropped`}>
          {t('gtaxi.dropped_body')}
        </Text>
      </TaxiCardShell>
    );
  }

  if (state.kind === 'failed') {
    return (
      <TaxiCardShell icon="garage" title={t('gtaxi.failed_title')} testID={testID}>
        <Text variant="body" color="textMuted">
          {t('gtaxi.failed_body')}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button testID={`${testID}-order-self`} icon="taxi" label={t('gtaxi.failed_order')} style={{ flex: 1 }} onPress={onOrderSelf} />
          <Button testID={`${testID}-retry-arm`} variant="secondary" icon="refresh" label={t('gtaxi.failed_retry')} loading={busy} disabled={offline} style={{ flex: 1 }} onPress={onArm} />
        </View>
        {offlineNote}
      </TaxiCardShell>
    );
  }

  if (state.kind === 'armed') {
    return (
      <TaxiCardShell icon="garage" title={t('gtaxi.armed_title')} pill={{ label: t('gtaxi.status_armed'), tone: 'accent', icon: 'clock' }} tone="tint" testID={testID}>
        <Text variant="body" testID={`${testID}-body`}>
          {t('gtaxi.armed_body', { minutes: view.placeAtEtaMin, garage, place })}
        </Text>
        <Text variant="caption" color="textMuted" tabular testID={`${testID}-eta`}>
          {view.carEtaMin !== null ? t('gtaxi.armed_eta', { minutes: view.carEtaMin }) : t('gtaxi.armed_waiting')}
        </Text>
        <PlaceChoice label={t('gtaxi.to_label')} places={view.places} value={chosen?.id ?? null} onChange={onPlace} disabled={offline || busy} />
        <Text variant="caption" color="textMuted" tabular>
          {view.estimateIqd !== null ? t('gtaxi.arm_estimate', { amount: amountParam(view.estimateIqd), pay }) : t('gtaxi.arm_no_estimate', { pay })}
        </Text>
        <View style={{ gap: theme.space[1] }}>
          <Button testID={`${testID}-disarm`} variant="secondary" icon="x" label={t('gtaxi.disarm')} loading={busy} disabled={offline} fullWidth onPress={onDisarm} />
          <Text variant="caption" color="successText" align="center">
            {t('gtaxi.armed_free')}
          </Text>
        </View>
        {offlineNote}
      </TaxiCardShell>
    );
  }

  return (
    <TaxiCardShell icon="garage" title={title} testID={testID}>
      <Text variant="body" testID={`${testID}-body`}>
        {t('gtaxi.arm_body', { garage, place })}
      </Text>
      <PlaceChoice label={t('gtaxi.to_label')} places={view.places} value={chosen?.id ?? null} onChange={onPlace} disabled={offline || busy} />
      <Text variant="caption" color="textMuted" tabular testID={`${testID}-estimate`}>
        {view.estimateIqd !== null ? t('gtaxi.arm_estimate', { amount: amountParam(view.estimateIqd), pay }) : t('gtaxi.arm_no_estimate', { pay })}
      </Text>
      <Button testID={`${testID}-arm`} icon="taxi" label={t('gtaxi.arm_button')} loading={busy} disabled={offline} fullWidth onPress={onArm} />
      {offlineNote}
    </TaxiCardShell>
  );
}
