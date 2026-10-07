import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Card, RetryState, retryKindFor, Skeleton, Text, useLoadTimeout, useNetwork, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { HandoverSheet } from '@/features/account/HandoverSheet';
import { useShiftSummary } from '@/features/account/queries';
import { shareDay } from '@/features/work/share-day';
import { ShareDayCard, ShiftCash, ShiftCompliments, ShiftGuarantee, ShiftHero, ShiftNudge, ShiftStats, ShiftTomorrow } from '@/features/work/ShiftParts';
import { shareCardModel, shareFileName, shiftRange } from '@/features/work/shift-logic';
import { useLocale, useT } from '@/lib/i18n';

/**
 * End of shift (UI/UX audit S-4), opened when he holds the switch to go offline: the shift's net and
 * per hour, jobs, time online, tips, the best hour, cash to hand over today with the code, tomorrow's
 * busiest window from last week, the G-91 shift guarantee (earned, paid or how far), one scorecard nudge at most, and "شارك يومك" — a picture of the day
 * for WhatsApp. Every number comes from `driverAccount.shiftSummary` (`?from=` is when the shift
 * started, read from `partner.status.onlineSince` before going offline).
 */
export default function ShiftSummaryScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const net = useNetwork();
  const params = useLocalSearchParams<{ from?: string }>();
  const from = useMemo(() => {
    const d = params.from ? new Date(params.from) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  }, [params.from]);
  const q = useShiftSummary(from);
  const s = q.data;
  const [slow, restartSlow] = useLoadTimeout(!s && !q.isError);
  const [code, setCode] = useState(false);
  const [sharing, setSharing] = useState(false);
  const card = useRef<View>(null);
  const model = useMemo(() => (s ? shareCardModel(s, t) : null), [s, t]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const share = async () => {
    if (!s || !model) return;
    setSharing(true);
    const r = await shareDay({ model, fileName: shareFileName(s), brand: { name: t('app.customer'), badge: t('partner.badge') }, view: card });
    setSharing(false);
    if (r === 'saved') toast.show({ message: t('partner.shiftsum_share_saved'), tone: 'success', icon: 'check' });
    if (r === 'failed') toast.show({ message: t('partner.shiftsum_share_failed'), tone: 'danger' });
  };

  return (
    <Screen
      testID="shift-summary"
      footer={
        s ? (
          <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <Button testID="shift-share" label={t('partner.shiftsum_share')} icon="share" variant="secondary" size="lg" loading={sharing} onPress={() => void share()} style={{ flex: 1 }} />
            <Button testID="shift-close" label={t('partner.shiftsum_done')} size="lg" onPress={close} style={{ flex: 1 }} />
          </View>
        ) : (
          <Button testID="shift-close" label={t('partner.shiftsum_done')} variant="secondary" size="lg" fullWidth onPress={close} />
        )
      }
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ gap: 2 }}>
        <Text variant="heading" accessibilityRole="header">
          {t('partner.shiftsum_title')}
        </Text>
        {s ? (
          <Text testID="shift-range" variant="footnote" color="textMuted" tabular>
            {shiftRange(s, t)}
          </Text>
        ) : null}
      </View>

      {!s ? (
        q.isError || slow ? (
          <RetryState
            testID="shift-retry"
            kind={retryKindFor({ net, error: q.error, slow })}
            locale={locale}
            title={net.state === 'offline' ? t('partner.shiftsum_offline') : t('partner.shiftsum_failed')}
            onRetry={() => {
              restartSlow();
              void q.refetch();
            }}
          />
        ) : (
          <View style={{ gap: theme.space[3] }} testID="shift-loading">
            <Card elevation={1} padding={5}>
              <Skeleton lines={3} />
            </Card>
            <Skeleton height={96} />
            <Skeleton height={140} />
          </View>
        )
      ) : (
        <>
          <ShiftHero s={s} />
          <ShiftStats s={s} />
          <ShiftGuarantee s={s} />
          <ShiftCash s={s} onCode={() => setCode(true)} />
          <ShiftCompliments s={s} onOpen={() => router.push('/compliments')} />
          <ShiftTomorrow s={s} />
          <ShiftNudge s={s} onOpen={() => router.push('/scorecard')} />
          {/* The picture "شارك يومك" captures on a phone; the web draws it on a canvas instead. */}
          {Platform.OS !== 'web' && model ? (
            <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ position: 'absolute', top: 0, left: -10_000 }}>
              <ShareDayCard ref={card} model={model} />
            </View>
          ) : null}
        </>
      )}
      {s ? <HandoverSheet visible={code} onClose={() => setCode(false)} heldIqd={s.cash.heldIqd} owedIqd={s.cash.owedIqd} /> : null}
    </Screen>
  );
}
