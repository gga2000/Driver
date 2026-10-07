import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { formatMinutes, formatWhen } from '@driver/i18n';
import { Button, Icon, Rule, Skeleton, StatusPill, Text, useNetwork, useTheme } from '@driver/ui';
import { seatsLeftLabel, seatsList } from '@/features/rajaa/labels';
import { bookingHref, minutesUntil } from '@/features/rajaa/logic';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { ArmedRideCard } from './ArmedRideCard';
import type { BaghdadModeState, CarBack } from './baghdad-mode';
import { useBaghdadMode } from './baghdad-mode-queries';
import { TaxiCardShell } from './GarageTaxiParts';

export interface BaghdadModeCardProps {
  testID?: string;
}

/**
 * «راجع للعزيزية؟» (ride idea n9 «Baghdad mode»), self-contained: when the phone's last known position
 * is in Baghdad (or Kut) it shows the next car back to Aziziyah from that city's garage — when it
 * leaves, the seats left and the seat price the server gives — with «احجز مقعد» on the seat booking
 * screen, and a quiet line for the one after. When he already holds a seat on a car back today it shows
 * that seat instead, with the n10 switch (`ArmedRideCard`: a taxi waiting at the Aziziyah garage).
 * It never asks for location: without permission, signed out, or anywhere else it renders nothing.
 */
export function BaghdadModeCard({ testID = 'baghdad-mode-card' }: BaghdadModeCardProps) {
  const net = useNetwork();
  const { state, now, refetch } = useBaghdadMode(net.online);
  return (
    <BaghdadModeCardView
      state={state}
      now={now.getTime()}
      onBook={(car) => router.push({ pathname: '/rajaa/departure/[id]', params: { id: car.departureId, corridor: car.corridorId, direction: 'to_aziziyah' } })}
      onSeeSeat={(seat) => router.push(bookingHref({ id: seat.bookingId, state: seat.state }) as never)}
      onWantBack={(corridorId) => router.push({ pathname: '/rajaa/demand', params: { corridor: corridorId, direction: 'to_aziziyah' } })}
      onRetry={refetch}
      armed={(bookingId) => <ArmedRideCard bookingId={bookingId} testID={`${testID}-armed`} />}
      testID={testID}
    />
  );
}

export interface BaghdadModeCardViewProps {
  state: BaghdadModeState;
  now: number;
  onBook: (car: CarBack) => void;
  onSeeSeat: (seat: Extract<BaghdadModeState, { kind: 'booked' }>['seat']) => void;
  onWantBack: (corridorId: string) => void;
  onRetry: () => void;
  /** Under his seat: the n10 switch for that booking (the live card passes `ArmedRideCard`). */
  armed?: (bookingId: string) => ReactNode;
  testID?: string;
}

/** The n9 card for a given state (the preview route renders each one). */
export function BaghdadModeCardView({ state, now, onBook, onSeeSeat, onWantBack, onRetry, armed, testID = 'baghdad-mode-card' }: BaghdadModeCardViewProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (state.kind === 'hidden') return null;

  const when = (d: Date) => formatWhen(d, now, { locale });
  const title = t('bmode.title');
  const pill = { label: t(state.cityId === 'kut' ? 'bmode.city_kut' : 'bmode.city_baghdad'), tone: 'neutral' as const, icon: 'map-pin' as const };
  const offline = 'offline' in state && state.offline;
  const offlineNote = offline ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Icon name="wifi-off" size={16} color="textMuted" />
      <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
        {t('bmode.offline')}
      </Text>
    </View>
  ) : null;

  if (state.kind === 'loading') {
    return (
      <TaxiCardShell icon="rajaa" title={title} pill={pill} testID={testID}>
        <View accessibilityRole="progressbar" accessibilityLabel={title} style={{ gap: theme.space[2] }}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="70%" height={28} />
          <Skeleton width="60%" height={14} />
          <Skeleton width="100%" height={48} radius={theme.radius.lg} />
        </View>
      </TaxiCardShell>
    );
  }

  if (state.kind === 'error' || state.kind === 'offline') {
    return (
      <TaxiCardShell icon="rajaa" title={title} pill={pill} testID={testID}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name={state.kind === 'offline' ? 'wifi-off' : 'refresh'} size={18} color="textMuted" />
          <Text variant="body" color="textMuted" style={{ flex: 1 }}>
            {t(state.kind === 'offline' ? 'bmode.offline' : 'bmode.load_error')}
          </Text>
        </View>
        {state.kind === 'error' ? <Button testID={`${testID}-retry`} variant="secondary" icon="refresh" label={t('gtaxi.retry')} fullWidth onPress={onRetry} /> : null}
      </TaxiCardShell>
    );
  }

  if (state.kind === 'booked') {
    const { seat } = state;
    const held = seat.state === 'held';
    return (
      <View style={{ gap: theme.space[3] }}>
        <TaxiCardShell
          icon="rajaa"
          title={t('bmode.booked_title')}
          pill={held ? { label: t('bmode.status_held'), tone: 'warning', icon: 'clock' } : { label: t('gtaxi.status_booked'), tone: 'success', icon: 'check' }}
          tone="tint"
          testID={testID}
        >
          <View style={{ gap: theme.space[1] }}>
            <Text variant="title" tabular testID={`${testID}-seat-time`}>
              {t('bmode.booked_body', { time: when(seat.departAt), garage: seat.garageNameAr })}
            </Text>
            <Text variant="body" color="textMuted">
              {t('bmode.booked_seat', { seats: seatsList(t, seat.seatIds) })}
            </Text>
            {held && seat.heldUntil ? (
              <Text variant="caption" color="warningText" tabular>
                {t('bmode.held_body', { time: when(seat.heldUntil) })}
              </Text>
            ) : null}
          </View>
          <Button testID={`${testID}-see-seat`} variant={held ? 'primary' : 'secondary'} icon={held ? 'seat' : 'chevron-back'} label={t(held ? 'bmode.finish' : 'bmode.see_pass')} fullWidth onPress={() => onSeeSeat(seat)} />
          {offlineNote}
        </TaxiCardShell>
        {!held && armed ? armed(seat.bookingId) : null}
      </View>
    );
  }

  if (state.kind === 'empty') {
    const car = state.announced;
    return (
      <TaxiCardShell icon="rajaa" title={title} pill={pill} testID={testID}>
        <View style={{ gap: theme.space[1] }}>
          <Text variant="bodyStrong" testID={`${testID}-empty`}>
            {t('bmode.empty_title')}
          </Text>
          <Text variant="body" color="textMuted" tabular>
            {car ? t('bmode.empty_announced', { when: when(car.departAt), garage: car.garageNameAr }) : t('bmode.empty_none')}
          </Text>
        </View>
        {car ? (
          <Button testID={`${testID}-book`} variant="secondary" icon="seat" label={t('bmode.book')} fullWidth disabled={offline} onPress={() => onBook(car)} />
        ) : (
          <Button testID={`${testID}-want`} variant="secondary" icon="flag" label={t('bmode.empty_demand')} fullWidth disabled={offline} onPress={() => onWantBack(state.corridorId)} />
        )}
        {offlineNote}
      </TaxiCardShell>
    );
  }

  const { next, after } = state;
  const mins = minutesUntil(next.departAt, new Date(now));
  return (
    <TaxiCardShell icon="rajaa" title={title} pill={pill} testID={testID}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="caption" color="textMuted">
          {t('bmode.next_label')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: theme.space[2] }}>
          <Text variant="heading" tabular testID={`${testID}-time`}>
            {t('bmode.next_time', { time: when(next.departAt) })}
          </Text>
          {mins > 0 ? (
            <Text variant="label" color="accentText" tabular>
              {t('bmode.next_in', { time: formatMinutes(mins, { locale }) })}
            </Text>
          ) : null}
        </View>
        <Text variant="body" testID={`${testID}-garage`}>
          {t('bmode.from_garage', { garage: next.garageNameAr })}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2] }}>
          <StatusPill size="sm" tone={next.free === 1 ? 'warning' : 'success'} icon="seat" label={seatsLeftLabel(t, next.free)} />
          <Text variant="label" tabular testID={`${testID}-price`}>
            {t('bmode.price', { amount: amountParam(next.seatPriceIqd) })}
          </Text>
        </View>
      </View>
      <Button testID={`${testID}-book`} icon="seat" label={t('bmode.book')} fullWidth disabled={offline} onPress={() => onBook(next)} />
      {after ? (
        <>
          <Rule />
          <Text variant="footnote" color="textMuted" tabular testID={`${testID}-after`}>
            {t('bmode.after', { time: when(after.departAt), seats: seatsLeftLabel(t, after.free) })}
          </Text>
        </>
      ) : null}
      {offlineNote}
    </TaxiCardShell>
  );
}
