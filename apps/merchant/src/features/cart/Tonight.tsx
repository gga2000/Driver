import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatHourPart } from '@driver/i18n';
import type { CartOwnerView, OwnerWalkupView } from '@driver/contracts';
import { Button, Icon, ModalSheet, Text, useTheme } from '@driver/ui';
import { useServerTime } from '@/features/board/clock';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { minutesBetween } from '@/lib/time';
import { useCounterToast } from '@/lib/toast';
import { useCartActions } from './queries';
import { nearestZone } from './spot';

/**
 * «طلبات الليلة» (cart owner concept v2): the ink strip says where the cart stands, since when and the
 * cash so far, with «سدّيت الليلة؟». Under it the walk-over tickets, oldest first, each by its number
 * (never a name or a phone): «جاهزة» or «ما أگدر هسه» while he cooks, «استلمها» once the customer is
 * at the cart. Delivery orders keep the restaurants' board, one tap away.
 */
export function Tonight({ view }: { view: CartOwnerView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [closing, setClosing] = useState(false);
  const actions = useCartActions();
  const toast = useCounterToast();
  const { cart, walkups, tonight } = view;
  const place = cart.spot ? (cart.spot.label ?? (locale === 'en' ? nearestZone(cart.spot).name_en : nearestZone(cart.spot).name_ar)) : '';
  const fail = (e: unknown) => toast.show({ tone: 'danger', message: apiErrorMessage(e, t('merchant.cart.failed'), locale) });

  return (
    <View style={{ gap: theme.space[4] }} testID="cart-tonight">
      <View style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.text, padding: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: theme.services.carts.fill }} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text variant="title" face="display" style={{ color: theme.colors.bg }} numberOfLines={2}>
            {place ? t('merchant.cart.open_at', { place }) : t('merchant.cart.open_now')}
          </Text>
          <Text variant="footnote" style={{ color: theme.colors.bg, opacity: 0.72 }} numberOfLines={1} tabular>
            {cart.openedAt ? t(tonight.cashIqd > 0 ? 'merchant.cart.open_since' : 'merchant.cart.open_since_only', { time: formatHourPart(cart.openedAt, { locale }), cash: iqd(tonight.cashIqd, { locale }) }) : iqd(tonight.cashIqd, { locale })}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setClosing(true)}
          testID="cart-close"
          style={({ pressed }) => ({ minHeight: 44, borderRadius: 22, paddingHorizontal: theme.space[4], justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)', opacity: pressed ? 0.8 : 1 })}
        >
          <Text variant="footnote" weight={600} style={{ color: theme.colors.bg }}>
            {t('merchant.cart.close_q')}
          </Text>
        </Pressable>
      </View>

      {walkups.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: theme.space[8], gap: theme.space[2] }} testID="cart-tonight-empty">
          <Icon name="walk" size={36} color={theme.colors.textMuted} />
          <Text variant="heading" face="display" align="center">
            {t('merchant.cart.empty_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('merchant.cart.empty_body', { n: cart.followers })}
          </Text>
        </View>
      ) : (
        walkups.map((w) => (
          <Ticket
            key={w.id}
            w={w}
            busy={actions.ready.isPending || actions.reject.isPending || actions.collect.isPending}
            onReady={() => actions.ready.mutate({ merchantOrgId: cart.merchantOrgId, walkupId: w.id }, { onError: fail })}
            onReject={() => actions.reject.mutate({ merchantOrgId: cart.merchantOrgId, walkupId: w.id }, { onError: fail, onSuccess: () => toast.show({ message: t('merchant.cart.rejected', { code: w.code }) }) })}
            onCollect={() =>
              actions.collect.mutate(
                { merchantOrgId: cart.merchantOrgId, walkupId: w.id, code: w.code },
                { onError: fail, onSuccess: () => toast.show({ tone: 'success', message: t('merchant.cart.collected', { code: w.code, amount: iqd(w.totalIqd, { locale }) }) }) },
              )
            }
          />
        ))
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => router.push('/cart/delivery')}
        testID="cart-delivery"
        style={({ pressed }) => ({ minHeight: 64, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], opacity: pressed ? 0.85 : 1 })}
      >
        <Icon name="bike" size={24} color={theme.colors.text} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body" weight={600}>
            {t('merchant.cart.delivery_row')}
          </Text>
          <Text variant="footnote" color="textMuted">
            {t('merchant.cart.delivery_sub')}
          </Text>
        </View>
        <Icon name="chevron-forward" size={20} color={theme.colors.textMuted} />
      </Pressable>

      <ModalSheet
        visible={closing}
        onClose={() => setClosing(false)}
        title={t('merchant.cart.close_title')}
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button
              label={t('merchant.cart.close_yes')}
              variant="primary"
              fullWidth
              loading={actions.close.isPending}
              onPress={() => actions.close.mutate({ merchantOrgId: cart.merchantOrgId }, { onError: fail, onSuccess: () => setClosing(false) })}
              testID="cart-close-yes"
            />
            <Button label={t('merchant.cart.close_no')} variant="ghost" fullWidth onPress={() => setClosing(false)} />
          </View>
        }
      >
        <Text variant="body" color="textMuted">
          {t('merchant.cart.close_body')}
        </Text>
      </ModalSheet>
    </View>
  );
}

/** One walk-over ticket (v2): its number big, who (always «جاي ماشي»), what, the cash he takes, and the next tap. */
function Ticket({ w, busy, onReady, onReject, onCollect }: { w: OwnerWalkupView; busy: boolean; onReady: () => void; onReject: () => void; onCollect: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const now = useServerTime(10_000);
  const c = theme.services.carts;
  const ready = w.state === 'ready';
  const left = Math.ceil((new Date(w.readyBy).getTime() - now) / 60_000);
  const timing = ready
    ? t('merchant.cart.waiting_since', { minutes: minutesBetween(w.readyAt ?? w.readyBy, now) })
    : left >= 0
      ? t('merchant.cart.wants_in', { minutes: Math.max(1, left) })
      : t('merchant.cart.late', { minutes: -left });
  const lines = w.lines.map((l) => `${l.qty} × ${l.nameAr}`).join('، ');

  return (
    <View testID={`cart-ticket-${w.code}`} style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, padding: theme.space[4], gap: theme.space[3], borderWidth: ready ? 2 : 0, borderColor: c.fill, ...theme.elevation[1] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <Text style={{ fontSize: 44, lineHeight: 52, fontWeight: '700', letterSpacing: 2, color: theme.colors.text, writingDirection: 'ltr' }} tabular accessibilityLabel={t('merchant.cart.ticket_a11y', { code: w.code.split('').join(' ') })}>
          {w.code}
        </Text>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="walk" size={18} color={theme.colors.text} />
            <Text variant="heading" face="display">
              {ready ? t('merchant.cart.ready_waiting') : t('merchant.cart.walker')}
            </Text>
          </View>
          <Text variant="footnote" color={!ready && left < 0 ? 'danger' : 'textMuted'} tabular>
            {timing}
          </Text>
        </View>
      </View>
      <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3] }}>
        <Text variant="body" style={{ flex: 1 }}>
          {lines}
        </Text>
        <Text variant="body" weight={700} tabular>
          {t('merchant.cart.pays', { amount: iqd(w.totalIqd, { locale }) })}
        </Text>
      </View>
      {w.note ? (
        <Text variant="footnote" color="textMuted">
          «{w.note}»
        </Text>
      ) : null}
      {ready ? (
        <CartButton label={t('merchant.cart.collect', { amount: iqd(w.totalIqd, { locale }) })} icon="cash" disabled={busy} onPress={onCollect} testID={`cart-collect-${w.code}`} />
      ) : (
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <Button label={t('merchant.cart.cant')} variant="secondary" disabled={busy} onPress={onReject} style={{ flex: 1 }} testID={`cart-reject-${w.code}`} />
          <CartButton label={t('merchant.cart.ready')} icon="check" disabled={busy} onPress={onReady} grow={2} testID={`cart-ready-${w.code}`} />
        </View>
      )}
    </View>
  );
}

/** The cart's own fuchsia action with ink on it (v2's «جاهزة»). */
function CartButton({ label, icon, disabled, onPress, grow, testID }: { label: string; icon: 'check' | 'cash'; disabled: boolean; onPress: () => void; grow?: number; testID: string }) {
  const theme = useTheme();
  const c = theme.services.carts;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({ flex: grow, minHeight: 56, borderRadius: 28, backgroundColor: c.fill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], paddingHorizontal: theme.space[4], opacity: disabled ? 0.55 : pressed ? 0.88 : 1 })}
    >
      <Icon name={icon} size={22} color={c.on} />
      <Text variant="heading" face="display" style={{ color: c.on }}>
        {label}
      </Text>
    </Pressable>
  );
}
