import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { EarlyCloseReason, type MerchantBalanceView, type StoreStatusView } from '@driver/contracts';
import { Button, ModalSheet, Text, TextField, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { MIcon, type MIconName } from '@/components/MIcon';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { clock12, minutesLeft } from '@/lib/time';
import { endOfDayClose, OTHER_LENGTHS } from '@/features/shop/pauses';
import { useRequestSettlement, useStoreSwitches } from './queries';

const CLOSE_ICON: Record<EarlyCloseReason, MIconName> = {
  sold_out: 'utensils',
  too_busy: 'flame',
  no_staff: 'people',
  power_cut: 'power',
  closing_early: 'clock',
  other: 'chat',
};

/** Says what closing did: back by itself at a time, «عاشت إيدك» at the end of the day (j4), or just closed. */
export function closedToast(t: ReturnType<typeof useT>, reason: EarlyCloseReason, minutes: number | null, now: number): string {
  if (minutes !== null) return t('merchant.shop.paused_toast', { time: clock12(now + minutes * 60_000) });
  return endOfDayClose(reason, minutes, now) ? t('merchant.shop.thanks_toast') : t('merchant.status.closed_toast');
}

/**
 * Close with a reason (edge-case decisions: early-close reason). From المحل (`lengths`) it also asks for
 * how long («نص ساعة · ساعة · ساعتين · لحد ما أفتحه»): the server opens the shop again by itself.
 */
export function CloseStoreSheet({ status, visible, onClose, lengths = false }: { status: StoreStatusView; visible: boolean; onClose: () => void; lengths?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { setOpen } = useStoreSwitches();
  const [reason, setReason] = useState<EarlyCloseReason | null>(null);
  const [length, setLength] = useState<number | null>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (visible) {
      setReason(null);
      setLength(null);
      setNote('');
    }
  }, [visible]);
  if (!visible) return null;
  const submit = async () => {
    if (!reason) return;
    try {
      await setOpen.mutateAsync({ merchantOrgId: status.merchantOrgId, open: false, reason, ...(note.trim() ? { note: note.trim() } : {}), ...(length !== null ? { pauseMinutes: length } : {}) });
      toast.show({ message: closedToast(t, reason, length, Date.now()), tone: 'neutral', icon: 'clock' });
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="close-sheet"
      title={t('merchant.status.close_title')}
      subtitle={t('merchant.status.close_body')}
      footer={<Button testID="close-confirm" label={t('merchant.status.close_confirm')} variant="destructive" size="lg" fullWidth disabled={!reason} loading={setOpen.isPending} onPress={() => void submit()} />}
    >
      <Text variant="title">{t('merchant.status.close_reason_q')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {EarlyCloseReason.options.map((r) => {
          const selected = reason === r;
          return (
            <Pressable
              key={r}
              testID={`close-${r}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setReason(r)}
              style={{
                flexBasis: '47%',
                flexGrow: 1,
                minHeight: 60,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                paddingHorizontal: theme.space[4],
                borderRadius: theme.radius.lg,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.colors.text : theme.colors.border,
                backgroundColor: selected ? theme.colors.surfaceSunken : theme.colors.surface,
              }}
            >
              <MIcon name={CLOSE_ICON[r]} size={22} color={selected ? 'text' : 'textMuted'} />
              <Text variant="bodyStrong">{t(`merchant.close_reason.${r}` as TKey)}</Text>
            </Pressable>
          );
        })}
      </View>
      {lengths ? (
        <>
          <Text variant="title">{t('merchant.shop.length_q')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {OTHER_LENGTHS.map((m) => {
              const selected = length === m;
              return (
                <Pressable
                  key={m ?? 'hand'}
                  testID={`close-length-${m ?? 'hand'}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setLength(m)}
                  style={{ flexBasis: '47%', flexGrow: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: theme.space[3], borderRadius: theme.radius.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? theme.colors.text : theme.colors.border, backgroundColor: selected ? theme.colors.surfaceSunken : theme.colors.surface }}
                >
                  <Text variant="bodyStrong">{m === null ? t('merchant.shop.length_hand') : m < 60 ? t('merchant.common.minutes', { minutes: m }) : m === 60 ? t('merchant.shop.length_hour') : t('merchant.shop.length_two_hours')}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
      <TextField value={note} onChangeText={setNote} placeholder={t('merchant.status.close_note')} maxLength={200} />
    </ModalSheet>
  );
}

/** Busy mode: explain +10 for an hour, switch it on or off. */
export function BusySheet({ status, visible, onClose, now }: { status: StoreStatusView; visible: boolean; onClose: () => void; now: number }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { setBusy } = useStoreSwitches();
  if (!visible) return null;
  const on = status.busy.on;
  const toggle = async () => {
    try {
      const s = await setBusy.mutateAsync({ merchantOrgId: status.merchantOrgId, on: !on });
      toast.show(
        s.busy.on
          ? { message: t('merchant.busy_mode_on', { minutes: s.busy.extraPrepMinutes }), tone: 'warning', icon: 'clock' }
          : { message: t('merchant.busy_mode_off'), tone: 'success' },
      );
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="busy-sheet"
      title={t('merchant.busy_mode')}
      footer={
        <Button
          testID="busy-toggle"
          label={on ? t('merchant.busy.turn_off') : t('merchant.busy.turn_on')}
          variant={on ? 'secondary' : 'primary'}
          size="lg"
          fullWidth
          loading={setBusy.isPending}
          onPress={() => void toggle()}
        />
      }
    >
      <View style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2] }}>
        <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: on ? theme.colors.warningTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name="flame" size={40} color={on ? 'warning' : 'textMuted'} />
        </View>
        <Text variant="numeralSm" color={on ? 'warningText' : 'text'}>
          {'\u2066+10\u2069'}
        </Text>
        <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 420 }}>
          {t('merchant.busy.sheet_body')}
        </Text>
        {on && status.busy.until ? (
          <Text variant="label" weight={600} color="warningText" tabular>
            {`${t('merchant.busy.ends_at', { time: clock12(status.busy.until) })} · ${t('merchant.common.minutes', { minutes: minutesLeft(status.busy.until, now) })}`}
          </Text>
        ) : null}
      </View>
    </ModalSheet>
  );
}

const CHANNEL: Record<string, TKey> = {
  courier: 'merchant.money.channel_courier',
  ops_round: 'merchant.money.channel_ops_round',
  zaincash: 'merchant.money.channel_zaincash',
  bank: 'merchant.money.channel_bank',
};

/** "اطلب فلوسك": the balance, who holds the cash, and the request (decisions §3, within the hour). */
export function CashSheet({ merchantOrgId, balance, visible, onClose }: { merchantOrgId: string; balance: MerchantBalanceView | undefined; visible: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const request = useRequestSettlement();
  if (!visible) return null;
  const amount = balance?.balanceIqd ?? 0;
  const plan = request.data;
  const submit = async () => {
    try {
      await request.mutateAsync({ merchantId: merchantOrgId });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="cash-sheet"
      title={plan ? t('merchant.request_money_sent') : t('merchant.money.request_title')}
      footer={
        plan ? (
          <Button label={t('action.done')} size="lg" fullWidth onPress={onClose} />
        ) : (
          <Button testID="cash-confirm" label={t('merchant.money.request_confirm')} icon="wallet" size="lg" fullWidth disabled={amount <= 0} loading={request.isPending} onPress={() => void submit()} />
        )
      }
    >
      <View style={{ alignItems: 'center', gap: theme.space[1], paddingVertical: theme.space[3], backgroundColor: theme.colors.successTint, borderRadius: theme.radius.xl }}>
        <Text variant="label" color="successText">
          {t('merchant.money.balance_label')}
        </Text>
        <Text variant="numeralMd" color="successText">
          {iqd(amount, { locale })}
        </Text>
      </View>
      {plan ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="bodyStrong">{t(CHANNEL[plan.channel] ?? 'merchant.money.channel_courier')}</Text>
          <Text variant="body" color="textMuted">
            {t('merchant.money.requested_at', { time: clock12(new Date()), target: clock12(plan.targetBy) })}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {t('merchant.money.reference', { reference: plan.reference })}
          </Text>
        </View>
      ) : amount > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="body">{t('merchant.money.request_body', { amount: amountParam(amount) })}</Text>
          {balance && balance.holders.length > 0 ? (
            <Text variant="footnote" color="textMuted">
              {t('merchant.money.holders', { count: balance.holders.length })}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text variant="body" color="textMuted" align="center">
          {t('merchant.money.nothing_due')}
        </Text>
      )}
    </ModalSheet>
  );
}
