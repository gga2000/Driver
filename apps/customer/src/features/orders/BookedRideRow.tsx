import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { OrderHistoryRow } from '@driver/contracts';
import { formatWhen } from '@driver/i18n';
import { Button, ModalSheet, StatusPill, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { useBookedRoute } from '@/features/ride-habits/queries';
import { apiErrorMessage, useApi, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { OrderArt, orderTitle } from './OrderRow';

/**
 * A ride booked «بعدين» in طلباتي (step 4, c10), with the coming trips: when (big), from where to
 * where, vehicle · fare · payment, «محجوز», and «ألغي» — free until a driver accepts, asked once
 * before it goes. Opens «مشوارك محجوز».
 */
export function BookedRideRow({ row, now, divider }: { row: OrderHistoryRow; now: Date; divider?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const net = useNetwork();
  const toast = useToast();
  const api = useApi();
  const client = useApiClient();
  const qc = useQueryClient();
  const o = row.order;
  const memo = useBookedRoute(o.id);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const when = o.scheduledFor ? formatWhen(o.scheduledFor, now) : '';
  const title = memo ? t('rajaa.route', { from: memo.from, to: memo.to }) : orderTitle(t, row, locale);
  const meta = [memo ? t(memo.vertical === 'tuktuk' ? 'ride.vehicle_tuktuk' : 'ride.vehicle_taxi') : null, t('habits.amount', { amount: amountParam(o.totalIqd) }), o.paymentMethod === 'wallet' ? t('ride.pay_wallet') : t('ride.pay_cash')]
    .filter(Boolean)
    .join(' · ');

  const cancel = async () => {
    setBusy(true);
    try {
      await client.orders.cancel.mutate({ orderId: o.id, reason: 'booked_ride_cancelled' });
      setAsking(false);
      toast.show({ message: t('orders.booked_cancelled', { when }), tone: 'neutral', icon: 'check' });
      void qc.invalidateQueries({ queryKey: api.orders.history.queryKey() });
      void qc.invalidateQueries({ queryKey: api.orders.mine.queryKey() });
    } catch (e) {
      toast.show({ message: apiErrorMessage(e, t('error.network'), locale), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ borderBottomWidth: divider ? 1 : 0, borderColor: theme.colors.border }}>
      <Pressable
        testID={`booked-${o.id}`}
        accessibilityRole="button"
        accessibilityLabel={[when, title, t('habits.booked_pill'), meta].join('، ')}
        onPress={() => router.push({ pathname: '/ride/booked/[id]', params: { id: o.id } })}
        style={({ pressed }) => ({ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], paddingBottom: theme.space[2], backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent' })}
      >
        {/* o8: the service's tile colour, as in the rows below (a ride booked for later may have no trip yet: the device memo says which). */}
        <OrderArt row={row.rideVertical ? row : { ...row, rideVertical: memo?.vertical === 'tuktuk' ? 'tuktuk' : 'taxi' }} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            <Text variant="title" tabular numberOfLines={1} style={{ flex: 1 }} testID={`booked-when-${o.id}`}>
              {when}
            </Text>
            <StatusPill size="sm" tone="accent" icon="clock" label={t('habits.booked_pill')} />
          </View>
          <Text variant="bodyStrong" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
            {meta}
          </Text>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', paddingHorizontal: theme.space[4], paddingBottom: theme.space[3], paddingStart: theme.space[4] + 48 + theme.space[3] }}>
        <Button testID={`booked-cancel-${o.id}`} variant="secondary" size="sm" icon="x" label={t('orders.booked_cancel')} disabled={!net.online} onPress={() => setAsking(true)} />
      </View>
      <ModalSheet
        visible={asking}
        onClose={() => (busy ? undefined : setAsking(false))}
        locked={busy}
        title={t('orders.booked_cancel_title', { when })}
        testID={`booked-cancel-sheet-${o.id}`}
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button testID={`booked-cancel-yes-${o.id}`} variant="destructive" label={t('orders.booked_cancel_yes')} loading={busy} disabled={!net.online} fullWidth onPress={() => void cancel()} />
            <Button label={t('orders.booked_cancel_no')} variant="ghost" fullWidth disabled={busy} onPress={() => setAsking(false)} />
          </View>
        }
      >
        <Text variant="body" color="textMuted">
          {t('orders.booked_cancel_body')}
        </Text>
      </ModalSheet>
    </View>
  );
}
