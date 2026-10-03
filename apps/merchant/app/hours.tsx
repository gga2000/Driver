import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { EntryTile } from '@/components/EntryTile';
import { Page } from '@/components/Page';
import { useServerNow } from '@/features/board/queries';
import { useCurrentStore, useStoreStatus, useStoreSwitches } from '@/features/store/queries';
import { BusySheet, CloseStoreSheet } from '@/features/store/StoreSheets';
import { apiErrorMessage } from '@/lib/api';
import { SUPPORT_PHONE } from '@/lib/env';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { clock12, minutesLeft } from '@/lib/time';

/** الدوام والزحمة — open/close the store now (with the early-close reason) and busy mode. */
export default function Hours() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { store } = useCurrentStore();
  const status = useStoreStatus(store?.orgId ?? null);
  const { setOpen } = useStoreSwitches();
  const now = useServerNow(0, 15_000);
  const [sheet, setSheet] = useState<'close' | 'busy' | null>(null);
  const s = status.data;

  const reopen = async () => {
    if (!s) return;
    try {
      await setOpen.mutateAsync({ merchantOrgId: s.merchantOrgId, open: true });
      toast.show({ message: t('merchant.status.opened'), tone: 'success' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <Page title={t('merchant.hours.title')} back testID="hours" maxWidth={720}>
      {!s ? (
        <Skeleton height={140} radius={20} />
      ) : (
        <>
          <View style={{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[5], gap: theme.space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Text variant="label" color="textMuted">
                {t('merchant.hours.now')}
              </Text>
              <StatusPill
                tone={s.open ? 'success' : s.pause && !s.closed ? 'warning' : 'danger'}
                dot
                label={s.open ? t('merchant.status.open') : s.closed ? t('merchant.status.closed') : t('merchant.status.paused', { time: s.pause?.until ?? '' })}
              />
            </View>
            {s.closed ? (
              <Text variant="bodyStrong" color="dangerText">{`${t(`merchant.close_reason.${s.closed.reason}` as TKey)} · ${clock12(s.closed.at)}`}</Text>
            ) : null}
            {s.open ? (
              <Button testID="hours-close" label={t('merchant.status.close_confirm')} variant="destructive" size="lg" icon="x" onPress={() => setSheet('close')} />
            ) : s.closed ? (
              <Button testID="hours-open" label={t('merchant.board.open_again')} size="lg" icon="check" loading={setOpen.isPending} onPress={() => void reopen()} />
            ) : null}
            <Text variant="footnote" color="textMuted">
              {t('merchant.hours.prep_default', { minutes: s.defaultPrepMinutes })}
            </Text>
          </View>
          <EntryTile
            testID="hours-busy"
            icon="flame"
            title={t('merchant.busy_mode')}
            hint={s.busy.on && s.busy.until ? `${t('merchant.busy.ends_at', { time: clock12(s.busy.until) })} · ${t('merchant.common.minutes', { minutes: minutesLeft(s.busy.until, now) })}` : t('merchant.busy.sheet_body')}
            onPress={() => setSheet('busy')}
            trailing={<StatusPill tone={s.busy.on ? 'warning' : 'neutral'} label={s.busy.on ? '\u2066+10\u2069' : t('merchant.busy.turn_on')} />}
          />
          <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.xl, padding: theme.space[5], gap: theme.space[3] }}>
            <Text variant="body" color="textMuted">
              {t('merchant.hours.weekly_note')}
            </Text>
            <Button label={t('merchant.more.support')} variant="secondary" icon="phone" onPress={() => void Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={{ alignSelf: 'flex-start' }} />
          </View>
          <CloseStoreSheet status={s} visible={sheet === 'close'} onClose={() => setSheet(null)} />
          <BusySheet status={s} visible={sheet === 'busy'} onClose={() => setSheet(null)} now={now} />
        </>
      )}
    </Page>
  );
}
