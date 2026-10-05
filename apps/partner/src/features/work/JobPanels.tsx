import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import type { PartnerCash, UnreachableStatus } from '@driver/contracts';
import { Button, Icon, SlideToConfirm, Text, useTheme, withAlpha } from '@driver/ui';
import { CashMeter } from '@/features/account/CashMeter';
import { HandoverSheet } from '@/features/account/HandoverSheet';
import { cashTruth } from '@/features/account/logic';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { clock, unreachablePhase } from './logic';

/**
 * Handover at the door: the photo (protects him in a dispute) and, for cash orders, the amount
 * owed and "استلمت ___ دينار". Confirming writes `trips.completeStop` with the cash collected.
 * TODO(upload): the photo is kept on the device for now; wave 2 uploads it (signed PUT like the
 * customer gate photo) and sends `handover.photoUrl`.
 */
export function HandoverPanel({ collectIqd, busy, onConfirm, onClose }: { collectIqd: number; busy: boolean; onConfirm: (photoUri: string | null) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [photo, setPhoto] = useState<string | null>(null);
  const cash = collectIqd > 0;

  const take = async () => {
    try {
      const res = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: false }).catch(() => ImagePicker.launchImageLibraryAsync({ quality: 0.6 }));
      if (!res.canceled && res.assets[0]) {
        setPhoto(res.assets[0].uri);
        theme.haptic('success');
      }
    } catch {
      /* camera unavailable: he can still confirm without a photo */
    }
  };

  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} testID="handover-panel" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="title">{cash ? t('partner.cash_title') : t('partner.photo_title')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={onClose} hitSlop={12}>
          <Icon name="x" size={22} color="textMuted" />
        </Pressable>
      </View>

      {cash ? (
        <View testID="cash-owed" style={{ alignItems: 'center', gap: 2, backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.xl, paddingVertical: theme.space[4] }}>
          <Text variant="label" color="warningText">
            {t('partner.cash_owed')}
          </Text>
          <Text tabular weight={700} color="text" style={{ fontSize: 40, lineHeight: 56 }}>
            {`${amountParam(collectIqd)} `}
            <Text variant="title" color="textMuted">
              {t('quote.currency')}
            </Text>
          </Text>
          <Text variant="caption" color="warningText" align="center" style={{ paddingHorizontal: theme.space[4] }}>
            {t('partner.cash_hint')}
          </Text>
        </View>
      ) : null}

      <Pressable
        testID="handover-photo"
        accessibilityRole="button"
        onPress={() => void take()}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          padding: theme.space[3],
          borderRadius: theme.radius.lg,
          borderWidth: 1.5,
          borderStyle: photo ? 'solid' : 'dashed',
          borderColor: photo ? theme.colors.success : theme.colors.borderStrong,
          backgroundColor: photo ? theme.colors.successTint : theme.colors.surface,
        }}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: 56, height: 56, borderRadius: 12 }} />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={24} color="textMuted" />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600} color={photo ? 'successText' : 'text'}>
            {photo ? t('partner.photo_saved') : t('partner.handover_photo')}
          </Text>
          <Text variant="caption" color="textMuted">
            {photo ? t('partner.photo_retake') : t('partner.photo_hint')}
          </Text>
        </View>
      </Pressable>

      {/* Handing over (and taking the cash) can't be undone: a slide, never a pocket tap (P-08). */}
      <SlideToConfirm testID="handover-confirm" label={cash ? t('partner.cash_confirm', { amount: amountParam(collectIqd) }) : t('partner.action_delivered')} loading={busy} onConfirm={() => onConfirm(photo)} />
    </Animated.View>
  );
}

/**
 * Unreachable-customer protocol (domain §2): we call and WhatsApp the customer, the dispatcher
 * joins at 3:00, and from 5:00 he may end the job (the customer pays). Calm, factual, with the
 * clock always visible.
 */
export function UnreachablePanel({ status, busy, onFail, onResponded }: { status: UnreachableStatus; busy: boolean; onFail: () => void; onResponded: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const p = unreachablePhase(status, now);
  const c = clock(p.remainingMs);
  const steps = [
    { key: 'call', label: t('partner.unreachable_step_call'), done: true },
    { key: 'dispatch', label: p.dispatcherAlerted ? t('unreachable.driver_dispatcher_alerted') : t('partner.unreachable_step_dispatch'), done: p.dispatcherAlerted },
    { key: 'end', label: t('partner.unreachable_step_end'), done: p.canFail },
  ];
  return (
    <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(180)} testID="unreachable-panel" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[4] }}>
        <View style={{ width: 88, height: 88, borderRadius: 44, borderWidth: 6, borderColor: p.canFail ? theme.colors.danger : theme.colors.warning, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="heading" tabular testID="unreachable-clock" color={p.canFail ? 'dangerText' : 'text'}>
            {`${c.minutes}:${c.seconds}`}
          </Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title">{t('partner.unreachable_title')}</Text>
          <Text variant="footnote" color="textMuted">
            {p.canFail ? t('unreachable.driver_mark_failed_hint') : t('unreachable.driver_calling')}
          </Text>
        </View>
      </View>
      <View style={{ gap: theme.space[2] }}>
        {steps.map((s) => (
          <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: s.done ? theme.colors.success : theme.colors.surfaceSunken }}>
              {s.done ? <Icon name="check" size={14} color="surface" strokeWidth={3} /> : <Icon name="clock" size={14} color="textMuted" />}
            </View>
            <Text variant="label" color={s.done ? 'text' : 'textMuted'} style={{ flex: 1 }}>
              {s.label}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ gap: theme.space[2] }}>
        <Button testID="unreachable-responded" label={t('unreachable.driver_customer_responded')} variant="secondary" size="lg" fullWidth onPress={onResponded} />
        <Button
          testID="unreachable-fail"
          label={p.canFail ? t('unreachable.driver_mark_failed') : t('unreachable.driver_timer', { minutes: c.minutes, seconds: c.seconds })}
          variant="destructive"
          size="lg"
          fullWidth
          disabled={!p.canFail}
          loading={busy}
          onPress={onFail}
        />
      </View>
    </Animated.View>
  );
}

/** Seconds before the done screen returns home on its own (partner S-3). */
export const DONE_AUTO_HOME_SEC = 4;

/**
 * End of a job (P-06, P-39, partner S-3): the check and what he earned, then where his cash stands —
 * the same "لازم تسلّم" meter as home — so he learns here, not from silence, that offers are about to
 * stop or have stopped. Near or over the cap: a card that says when offers stop and a "سلّم الفلوس"
 * button (the hand-over sheet with the amount). Over the cap that card replaces the auto-return;
 * otherwise it counts down home in 4 s ("نرجعك للطلبات…") with a "خليني هنا" escape.
 */
export function DonePanel({ earnedIqd, failed, onHome, cash }: { earnedIqd: number; failed: boolean; onHome: () => void; cash?: PartnerCash | null }) {
  const theme = useTheme();
  const t = useT();
  const [handover, setHandover] = useState(false);
  const truth = cash ? cashTruth({ owedIqd: cash.owedIqd, heldIqd: cash.heldIqd, capIqd: cash.capIqd, overCap: cash.overCap }) : null;
  const urgent = truth ? truth.tone !== 'success' : false;
  const autoHome = !failed && !(truth?.over ?? false);
  const [stay, setStay] = useState(false);
  const [left, setLeft] = useState(DONE_AUTO_HOME_SEC);
  const counting = autoHome && !stay && !handover;
  const home = useRef(onHome);
  home.current = onHome;
  useEffect(() => {
    if (!counting) return;
    if (left <= 0) {
      home.current();
      return;
    }
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [counting, left]);
  return (
    <View testID="job-done" style={{ flex: 1, justifyContent: 'center', gap: theme.space[5], padding: theme.space[6] }}>
      <View style={{ alignItems: 'center', gap: theme.space[4] }}>
        <Animated.View
          entering={theme.reduceMotion ? undefined : ZoomIn.springify().damping(12)}
          style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: failed ? theme.colors.surfaceSunken : theme.colors.success, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name={failed ? 'clock' : 'check'} size={48} color={failed ? 'textMuted' : 'surface'} strokeWidth={2.6} />
        </Animated.View>
        <View style={{ alignItems: 'center', gap: theme.space[1] }}>
          <Text variant="heading" align="center">
            {failed ? t('partner.job_failed_title') : t('partner.job_done_title')}
          </Text>
          {!failed && earnedIqd > 0 ? (
            <Text variant="title" color="successText" tabular testID="job-done-earned">
              {t('partner.job_done_earned', { amount: amountParam(earnedIqd, { sign: true }) })}
            </Text>
          ) : null}
        </View>
      </View>
      {cash && truth ? (
        <View
          testID="done-cash"
          style={{
            gap: theme.space[3],
            padding: theme.space[4],
            borderRadius: theme.radius.xl,
            backgroundColor: truth.tone === 'danger' ? theme.colors.dangerTint : truth.tone === 'warning' ? theme.colors.warningTint : theme.colors.surface,
            borderWidth: 1,
            borderColor: urgent ? withAlpha(theme.colors[truth.tone], 0.35) : theme.colors.border,
          }}
        >
          <CashMeter owedIqd={cash.owedIqd} heldIqd={cash.heldIqd} capIqd={cash.capIqd} overCap={cash.overCap} testID="done-meter" />
          {urgent ? <Button testID="done-settle" label={t('partner.handover_cta')} icon="wallet" fullWidth onPress={() => setHandover(true)} /> : null}
        </View>
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        <Button testID="job-done-home" label={t('partner.job_done_cta')} size="lg" variant={urgent ? 'secondary' : 'primary'} fullWidth onPress={onHome} />
        {counting ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }}>
            <Text variant="footnote" color="textMuted" tabular testID="done-countdown" accessibilityLiveRegion="polite">
              {t('partner.done_auto_home', { n: left })}
            </Text>
            <Button testID="done-stay" label={t('partner.done_stay')} size="sm" variant="ghost" onPress={() => setStay(true)} />
          </View>
        ) : null}
      </View>
      {cash ? <HandoverSheet visible={handover} onClose={() => setHandover(false)} heldIqd={cash.heldIqd} owedIqd={cash.owedIqd} /> : null}
    </View>
  );
}
