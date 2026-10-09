import { useEffect, useState } from 'react';
import { View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Button, ModalSheet, Text, useTheme } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { InfoStrip } from './Banners';
import { beatLog, pauseView, useBeatLog, type AutoBusy, type PauseView, type RemakeOutcome } from './shop-load';

/** Device time, re-read every `ms` while `on` (the pause counts from the last beat the server answered). */
function useNow(on: boolean, ms = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [on, ms]);
  return now;
}

/**
 * h5 on the board, in place of the plain offline strip: offline it says when customers will see the
 * shop closed («إذا ظل بلا نت 3 دقيقة بعد…»), then that they do now and how it comes back; after a pause
 * (the app was closed or offline for more than 5 minutes) it says how long customers saw it closed and
 * how to keep it open, until «تمام».
 */
export function usePauseView(online: boolean): PauseView {
  const log = useBeatLog();
  const now = useNow(!online);
  return pauseView({ now, online, lastOkAt: log.lastOkAt, back: log.back });
}

export function PauseStrip({ online, view }: { online: boolean; view: PauseView }) {
  const t = useT();
  if (view.kind === 'paused') {
    // Day-one d07: paused is the one banner on the board (the alarm band, the rings and the app's
    // connection strip step aside), in one sentence: what customers see, since when, what happens next.
    return <InfoStrip tone="warning" icon="wifi-off" testID="paused-strip" text={t('merchant.paused.one', { minutes: view.offMinutes })} />;
  }
  if (!online) {
    return <InfoStrip tone="neutral" icon="wifi-off" testID="offline-strip" text={t('merchant.offline.strip')} {...(view.kind === 'soon' ? { sub: t('merchant.paused.soon', { minutes: view.minutesLeft }) } : {})} />;
  }
  if (view.kind === 'back') {
    return (
      <InfoStrip
        tone="success"
        icon="store"
        testID="paused-back-strip"
        text={t('merchant.paused.back', { minutes: view.minutes })}
        sub={t('merchant.paused.back_how')}
        action={{ label: t('merchant.paused.ok'), onPress: () => beatLog.dismiss(), testID: 'paused-back-ok' }}
      />
    );
  }
  return null;
}

/**
 * l4 on the board: «زحمة تلقائية · 15 طلب ينتظر». Not the gold of the shop's own busy mode (that one is
 * the shop's switch); a quiet strip on the counter's sand with a gold edge, and «شنو هذا؟» opens the busy sheet.
 */
export function AutoBusyStrip({ auto, manualOn, onMore }: { auto: AutoBusy; manualOn: boolean; onMore: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="auto-busy-strip"
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[3], rowGap: theme.space[2], paddingHorizontal: theme.space[5], paddingVertical: theme.space[2], minHeight: 48, backgroundColor: COUNTER.sand, borderStartWidth: 6, borderStartColor: COUNTER.busy }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], flexGrow: 1, flexShrink: 1, flexBasis: 240 }}>
        <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: COUNTER.busy, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name="flame" size={16} color={COUNTER.qty} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700} tabular style={{ color: COUNTER.date }}>
            {t('merchant.busy.auto_strip', { count: auto.waiting })}
          </Text>
          <Text variant="footnote" style={{ color: COUNTER.qty }}>
            {manualOn ? t('merchant.busy.auto_strip_sub_manual') : t('merchant.busy.auto_strip_sub')}
          </Text>
        </View>
      </View>
      <Button testID="auto-busy-more" label={t('merchant.busy.auto_more')} variant="ghost" size="sm" onPress={onMore} style={{ marginStart: 'auto' }} />
    </View>
  );
}

/** The busy sheet's explanation of l4, and whether it holds now. */
export function AutoBusyNote({ auto }: { auto: AutoBusy | null }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="busy-auto-note" style={{ gap: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: COUNTER.sand, borderStartWidth: 4, borderStartColor: COUNTER.busy }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <MIcon name="flame" size={16} color={COUNTER.qty} />
        <Text variant="label" weight={700} style={{ flex: 1, color: COUNTER.date }}>
          {t('merchant.busy.auto_title')}
        </Text>
        {auto?.on ? (
          <Text testID="busy-auto-now" variant="footnote" weight={700} tabular style={{ color: COUNTER.qty }}>
            {t('merchant.busy.auto_now', { count: auto.waiting })}
          </Text>
        ) : null}
      </View>
      <Text variant="footnote" style={{ color: COUNTER.qty }}>
        {t('merchant.busy.auto_body')}
      </Text>
    </View>
  );
}

/**
 * c6 «أعدنا تسويه»: what Driver pays and when, then the answer — the amount paid, or «انحسبت قبل».
 */
export function RemakeSheet({ order, minutes, outcome, busy, onConfirm, onClose }: { order: BoardOrder | null; minutes: number; outcome: RemakeOutcome | null; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  if (!order) return null;
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="remake-sheet"
      title={t('merchant.remake.title', { number: order.number })}
      footer={
        outcome ? (
          <Button testID="remake-done" label={t('merchant.paused.ok')} variant="secondary" size="lg" fullWidth onPress={onClose} />
        ) : (
          <Button testID="remake-confirm" label={t('merchant.remake.confirm')} icon="refresh" size="lg" fullWidth loading={busy} onPress={onConfirm} />
        )
      }
    >
      {outcome ? (
        <View testID={`remake-${outcome.kind}`} style={{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3] }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: outcome.kind === 'paid' ? COUNTER.ready : COUNTER.sand, alignItems: 'center', justifyContent: 'center' }}>
            <MIcon name="check" size={34} color={outcome.kind === 'paid' ? COUNTER.onDate : COUNTER.qty} strokeWidth={2.6} />
          </View>
          {outcome.kind === 'paid' ? (
            <Text variant="title" align="center" tabular>
              {t('merchant.remake.paid', { amount: iqd(outcome.amountIqd, { locale }) })}
            </Text>
          ) : (
            <Text variant="title" align="center">
              {t('merchant.remake.already')}
            </Text>
          )}
        </View>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="body" color="textMuted">
            {t('merchant.remake.body', { minutes })}
          </Text>
        </View>
      )}
    </ModalSheet>
  );
}
