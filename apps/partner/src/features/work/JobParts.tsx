import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PartnerMerchantPrep } from '@driver/contracts';
import { Badge, Button, Icon, ModalSheet, Text, useTheme, type IconName } from '@driver/ui';
import { useFullBrightness } from '@/lib/brightness';
import { useT } from '@/lib/i18n';
import { RAIL_KEYS, waitClock, type RailStage } from './job-steps';

/**
 * The job screen's parts (partner redesign j1–j9, r6): the step rail, the place as a headline, the big
 * pickup code, the kitchen's ready bar, the four actions over the main button, and the problem sheet.
 */

/** j1: four places in a row — done ones ticked, the current one lit in the accent, the rest waiting. */
export function ProgressRail({ stage, ride }: { stage: RailStage; ride: boolean }) {
  const theme = useTheme();
  const t = useT();
  const keys = RAIL_KEYS[ride ? 'ride' : 'food'];
  return (
    <View testID="job-rail" accessible accessibilityRole="progressbar" accessibilityLabel={t('partner.rail_a11y', { n: stage + 1, name: t(keys[stage]) })} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
      {keys.map((k, i) => {
        const done = i < stage;
        const current = i === stage;
        return (
          <View key={k} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
            <View style={{ width: '100%', height: 24, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i === 0 ? 'transparent' : i <= stage ? theme.colors.text : theme.colors.border }} />
              <View
                style={{
                  width: current ? 24 : 18,
                  height: current ? 24 : 18,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? theme.colors.text : current ? theme.colors.accent : theme.colors.surface,
                  borderWidth: done || current ? 0 : 2,
                  borderColor: theme.colors.border,
                }}
              >
                {done ? <Icon name="check" size={12} color="surface" strokeWidth={3} /> : current ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.onAccent }} /> : null}
              </View>
              <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: i === keys.length - 1 ? 'transparent' : i < stage ? theme.colors.text : theme.colors.border }} />
            </View>
            <Text variant="caption" weight={current ? 700 : 500} color={current ? 'text' : 'textMuted'} numberOfLines={1} compact>
              {t(k)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * j2: the place as the headline. At a door, the customer's own words lead («باب أخضر، يم جامع الرسول»)
 * with the landmark under them; at a kitchen, its name and what it is near.
 */
export function PlaceHeadline({ icon, ink, title, quote, near, zone, aside }: { icon: IconName; ink: boolean; title: string; quote: string | null; near: string | null; zone: string; aside?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View testID="job-place" style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: ink ? theme.colors.text : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={22} color={ink ? 'surface' : 'text'} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="label" color="textMuted" numberOfLines={1}>
            {near ? `${near} · ${zone}` : zone}
          </Text>
        </View>
        {aside}
      </View>
      {quote ? (
        <View testID="job-door-quote" style={{ flexDirection: 'row', gap: theme.space[3], paddingStart: theme.space[1] }}>
          <View style={{ width: 4, borderRadius: 2, backgroundColor: theme.colors.accent }} />
          <Text variant="title" weight={700} style={{ flex: 1, fontSize: 22, lineHeight: 34 }}>
            {`«${quote}»`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * j5: the pickup code at a size the counter can read from across it; a tap fills the screen with it at
 * full brightness (native) until he closes it.
 */
export function PickupCode({ code, place }: { code: string; place: string }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  useFullBrightness(open);
  const spoken = code.split('').join(' ');
  return (
    <>
      <Pressable
        testID="job-pickup-code"
        accessibilityRole="button"
        accessibilityLabel={`${t('partner.job_pickup_code')}: ${spoken}`}
        accessibilityHint={t('partner.code_tap_hint')}
        onPress={() => {
          theme.haptic('selection');
          setOpen(true);
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          borderRadius: theme.radius.xl,
          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
          borderWidth: 2,
          borderColor: theme.colors.text,
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[3],
        })}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700}>
            {t('partner.job_pickup_code')}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('partner.code_tap_hint')}
          </Text>
        </View>
        <Text tabular weight={700} style={{ fontSize: 40, lineHeight: 52, letterSpacing: 6 }}>
          {code}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.surface }} testID="job-code-full">
          <Pressable accessibilityRole="button" accessibilityLabel={t('action.close')} onPress={() => setOpen(false)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.space[5], gap: theme.space[4] }}>
            <Text variant="title" color="textMuted" align="center">
              {place}
            </Text>
            <Text tabular weight={700} align="center" accessibilityLabel={spoken} style={{ fontSize: Math.min(160, Math.floor(width / 3.4)), lineHeight: Math.min(200, Math.floor(width / 2.6)), letterSpacing: 8, direction: 'ltr' } as never}>
              {code}
            </Text>
            <Text variant="bodyStrong" align="center">
              {t('partner.code_full_title')}
            </Text>
          </Pressable>
          <View style={{ padding: theme.space[5] }}>
            <Button label={t('action.close')} variant="secondary" size="lg" fullWidth onPress={() => setOpen(false)} testID="job-code-close" />
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

/**
 * j6: while the kitchen cooks — «جاهز بعد 4 دقيقة» with a bar that fills toward ready, from the first
 * minutes the screen saw; green «الأكل جاهز، استلمه» once it is.
 */
export function ReadyBar({ prep }: { prep: PartnerMerchantPrep }) {
  const theme = useTheme();
  const t = useT();
  const ready = prep.state === 'ready' || prep.state === 'picked_up';
  const first = useRef<number | null>(null);
  if (!ready && prep.readyInMin !== null && (first.current === null || prep.readyInMin > first.current)) first.current = Math.max(1, prep.readyInMin);
  const share = ready ? 1 : prep.readyInMin !== null && first.current ? Math.max(0.06, 1 - prep.readyInMin / first.current) : 0.06;
  const w = useSharedValue(share);
  useEffect(() => {
    w.value = theme.reduceMotion ? share : withTiming(share, { duration: 600, easing: Easing.out(Easing.cubic) });
  }, [share, theme.reduceMotion, w]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  const label = ready ? t('partner.ready_bar_ready') : prep.state === 'preparing' && prep.readyInMin ? t('partner.offer_prep_preparing', { minutes: prep.readyInMin }) : prep.state === 'preparing' ? t('partner.offer_prep_cooking') : t('partner.offer_prep_waiting');
  return (
    <View testID="job-ready-bar" accessibilityLiveRegion="polite" style={{ gap: theme.space[2], borderRadius: theme.radius.lg, padding: theme.space[3], backgroundColor: ready ? theme.colors.successTint : theme.colors.warningTint }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name={ready ? 'check' : 'clock'} size={20} color={ready ? 'successText' : 'warningText'} strokeWidth={2.3} />
        <Text variant="label" weight={700} color={ready ? 'successText' : 'warningText'} tabular style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surface, overflow: 'hidden' }}>
        <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: ready ? theme.colors.success : theme.colors.warning }, fill]} />
      </View>
    </View>
  );
}

/** r6: «صار لك تنتظر 3:07» from the moment he reached the rider (shown only). */
export function RiderWait({ arrivedAt }: { arrivedAt: Date | null }) {
  const theme = useTheme();
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!arrivedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [arrivedAt]);
  const c = waitClock(arrivedAt, now);
  if (!c) return null;
  return (
    <View testID="job-rider-wait" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: theme.space[3], minHeight: 36, backgroundColor: c.minutes >= 5 ? theme.colors.warningTint : theme.colors.surfaceSunken }}>
      <Icon name="clock" size={18} color={c.minutes >= 5 ? 'warningText' : 'text'} strokeWidth={2.2} />
      <Text variant="label" weight={700} tabular color={c.minutes >= 5 ? 'warningText' : 'text'}>
        {t('partner.rider_wait', { time: c.text })}
      </Text>
    </View>
  );
}

export interface JobActionItem {
  key: string;
  icon: IconName;
  label: string;
  onPress: () => void;
  badge?: number;
  /** Greyed with this tag («قريباً») but still tappable: it says why and offers the chat. */
  soon?: string;
  disabled?: boolean;
  testID: string;
}

/** j4 / b4: the four actions in one row right above the main button, where the thumb already is. */
export function JobActions({ items }: { items: readonly JobActionItem[] }) {
  const theme = useTheme();
  return (
    <View testID="job-actions" style={{ flexDirection: 'row', gap: theme.space[2] }}>
      {items.map((a) => (
        <Pressable
          key={a.key}
          testID={a.testID}
          accessibilityRole="button"
          accessibilityLabel={a.badge ? `${a.label} · ${a.badge}` : a.soon ? `${a.label} · ${a.soon}` : a.label}
          accessibilityState={{ disabled: Boolean(a.disabled) }}
          disabled={a.disabled}
          onPress={a.onPress}
          style={({ pressed }) => ({
            flex: 1,
            minHeight: 56,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
            borderRadius: theme.radius.lg,
            backgroundColor: pressed ? theme.colors.border : theme.colors.surfaceSunken,
            opacity: a.disabled ? 0.5 : 1,
          })}
        >
          <View>
            <Icon name={a.icon} size={22} color={a.soon ? 'textMuted' : 'text'} strokeWidth={2} />
            {a.badge ? <Badge count={a.badge} style={{ position: 'absolute', top: -8, end: -14 }} /> : null}
          </View>
          <Text variant="caption" weight={600} color={a.soon ? 'textMuted' : 'text'} numberOfLines={1} compact>
            {a.soon ? `${a.label} · ${a.soon}` : a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export interface ProblemItem {
  key: string;
  icon: IconName;
  title: string;
  body: string;
  tone?: 'danger' | 'neutral';
  onPress: () => void;
}

/** j4 «مشكلة»: what can go wrong at this step, one tap each — never a dead end. */
export function ProblemSheet({ visible, items, onClose }: { visible: boolean; items: readonly ProblemItem[]; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('partner.problem_title')} testID="job-problem-sheet" sheetMaxWidth={560}>
      <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(160)} style={{ gap: theme.space[2] }}>
        {items.map((it) => (
          <Pressable
            key={it.key}
            testID={`problem-${it.key}`}
            accessibilityRole="button"
            onPress={() => {
              onClose();
              it.onPress();
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              minHeight: 64,
              paddingHorizontal: theme.space[3],
              borderRadius: theme.radius.lg,
              backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
              borderWidth: 1,
              borderColor: theme.colors.border,
            })}
          >
            <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: it.tone === 'danger' ? theme.colors.dangerTint : theme.colors.surfaceSunken }}>
              <Icon name={it.icon} size={20} color={it.tone === 'danger' ? 'dangerText' : 'text'} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="label" weight={700}>
                {it.title}
              </Text>
              <Text variant="caption" color="textMuted">
                {it.body}
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color="textMuted" />
          </Pressable>
        ))}
      </Animated.View>
    </ModalSheet>
  );
}
