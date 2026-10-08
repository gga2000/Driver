import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { Easing, FadeIn, ZoomIn, cancelAnimation, useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { Avatar, Card, CountdownRing, Icon, SketchScene, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { FoodArt, type DishArt } from './FoodArt';
import { softRingProgress, type PersonLines, type WaitingStep } from './kitchen-moment';

/** The waiting kitchen drawing's width (joy J4) and the accept-ring medallion that sits on its sill. */
const SCENE_MAX = 300;
const MEDALLION = 76;

/**
 * The kitchen at work (joy J4 + o14): a pot on the fire with its steam drifting (still under reduced
 * motion) and the 90 s accept ring as a medallion on the sill. When the kitchen says yes the ring
 * closes in the success colour with a check that pops in (transforms and opacity only).
 */
export function KitchenMark({ startedAt, acceptMs, accepted, animate }: { startedAt: number; acceptMs: number; accepted: boolean; animate: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ width: '100%', maxWidth: SCENE_MAX, alignItems: 'center' }}>
      <SketchScene name="kitchen" />
      <View
        style={{
          marginTop: -MEDALLION / 2,
          width: MEDALLION,
          height: MEDALLION,
          borderRadius: MEDALLION / 2,
          backgroundColor: theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {accepted ? (
          <Animated.View
            testID="kitchen-accepted-ring"
            entering={animate ? ZoomIn.springify().damping(theme.motion.spring.celebrate.damping).stiffness(theme.motion.spring.celebrate.stiffness) : undefined}
            style={{
              width: MEDALLION - 10,
              height: MEDALLION - 10,
              borderRadius: (MEDALLION - 10) / 2,
              borderWidth: 5,
              borderColor: theme.colors.success,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="check" size={30} color="successText" strokeWidth={3} />
          </Animated.View>
        ) : (
          // «1:29» reads as time; a bare «89» didn't say what it counted (VIS-31).
          <CountdownRing mode="accept" startedAt={startedAt} durationMs={acceptMs} format="clock" size={MEDALLION - 10} strokeWidth={5} />
        )}
      </View>
    </View>
  );
}

const STEP_LABEL = { sent: 'kitchen.step_sent', confirm: 'kitchen.step_confirm', cooking: 'kitchen.step_cooking' } as const;

/**
 * «وصل للمطعم ✓ · المطعم يأكّد · يتحضّر»: the three real steps, current one in the live colour, or in
 * saffron on the redesigned kitchen card (`saffron`, after-order design w1: no teal anywhere).
 */
export function WaitingSteps({ steps, saffron }: { steps: WaitingStep[]; saffron?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const c = saffron
    ? { line: theme.colors.accent, fill: theme.colors.accent, soft: theme.colors.accentTint, text: 'accentText' as const, mark: 'onAccent' as const }
    : { line: theme.colors.live, fill: theme.colors.live, soft: theme.colors.liveTint, text: 'liveText' as const, mark: 'onInverse' as const };
  const spoken = steps
    .filter((s) => s.state !== 'todo')
    .map((s) => t(s.state === 'done' ? 'kitchen.step_done_a11y' : 'kitchen.step_current_a11y', { step: t(STEP_LABEL[s.key]) }))
    .join('، ');
  return (
    <View
      testID="kitchen-steps"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('kitchen.steps_a11y', { steps: spoken })}
      accessibilityLiveRegion="polite"
      style={{ flexDirection: 'row', alignItems: 'flex-start', alignSelf: 'stretch' }}
    >
      {steps.map((s, i) => {
        const done = s.state === 'done';
        const current = s.state === 'current';
        return (
          <View key={s.key} style={{ flex: 1, alignItems: 'center', gap: theme.space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' }}>
              <View style={{ flex: 1, height: 2, backgroundColor: i === 0 ? 'transparent' : done || current ? c.line : theme.colors.border }} />
              <View
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? c.fill : current ? c.soft : theme.colors.surfaceSunken,
                  borderWidth: current ? 2 : 0,
                  borderColor: c.fill,
                }}
              >
                {done ? <Icon name="check" size={13} color={c.mark} strokeWidth={3} /> : current ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.fill }} /> : null}
              </View>
              <View style={{ flex: 1, height: 2, backgroundColor: i === steps.length - 1 ? 'transparent' : done ? c.line : theme.colors.border }} />
            </View>
            <Text variant="caption" weight={current ? 700 : 400} color={done || current ? c.text : 'textMuted'} align="center">
              {t(STEP_LABEL[s.key])}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The order by person, with each kitchen note, so the kids' notes are seen to have gone through. */
export function PersonLinesCard({ groups, myName, totalLine }: { groups: PersonLines[]; myName: string | null; totalLine: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Card elevation={0} tone="sunken" padding={3} style={{ alignSelf: 'stretch' }} testID="kitchen-lines">
      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="wallet" size={18} color="text" />
          <Text variant="label" weight={600} tabular style={{ flex: 1 }}>
            {totalLine}
          </Text>
        </View>
        {groups.map((g) => (
          <View key={g.personId} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
            {g.kind === 'table' ? <Avatar size={28} icon="family" tone="accent" /> : <Avatar size={28} name={g.name ?? myName ?? t('item.for_me_chip')} tone={g.name ? undefined : 'accent'} />}
            <Text variant="footnote" style={{ flex: 1 }}>
              <Text variant="footnote" weight={600}>
                {g.kind === 'table' ? t('cart.for_table_section') : (g.name ?? t('cart.for_me_section'))}:{' '}
              </Text>
              {g.lines.join('، ')}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

/** «مطعم خالد قبل طلبك · يوصلك تقريباً 7:45 م», held for a moment before tracking opens. */
export function AcceptedCard({ name, time, animate }: { name: string; time: string; animate: boolean }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Animated.View
      entering={animate ? FadeIn.duration(theme.motion.duration.base) : undefined}
      testID="kitchen-accepted"
      accessible
      accessibilityRole="alert"
      accessibilityLabel={t('kitchen.accepted_a11y', { name, time })}
      accessibilityLiveRegion="assertive"
      style={{ alignItems: 'center', gap: theme.space[1] }}
    >
      <Text variant="heading" align="center">
        {t('kitchen.accepted_title', { name })}
      </Text>
      <Text variant="title" color="successText" align="center" tabular>
        {t('kitchen.accepted_eta', { time })}
      </Text>
    </Animated.View>
  );
}

const RING = 132;
const RING_STROKE = 6;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The redesigned kitchen wait (after-order design w1 + w2): the dish you ordered in a gold ring on a
 * warm card, instead of a 90-second countdown. The ring fills softly toward the kitchen's answer and
 * never prints seconds or turns red; the «بعده ما رد» line under it says when the kitchen is slow.
 * When the kitchen says yes the ring closes and a check pops in. Reduced motion: the ring steps with
 * the screen's clock instead of gliding.
 */
export function KitchenCard({ art, startedAt, acceptMs, now, accepted, children }: { art: DishArt; startedAt: number; acceptMs: number; now: number; accepted: boolean; children: ReactNode }) {
  const theme = useTheme();
  const t = useT();
  const r = (RING - RING_STROKE) / 2;
  const length = 2 * Math.PI * r;
  const shown = useSharedValue(softRingProgress(startedAt, acceptMs, now, accepted));
  useEffect(() => {
    const target = softRingProgress(startedAt, acceptMs, now, accepted);
    if (theme.reduceMotion) {
      shown.value = target;
      return;
    }
    // Glide toward where the ring will be when the screen's clock next ticks (5 s), or close it.
    const ahead = accepted ? 1 : softRingProgress(startedAt, acceptMs, now + 5_000, false);
    shown.value = withTiming(ahead, { duration: accepted ? theme.motion.duration.base : 5_000, easing: Easing.linear });
    return () => cancelAnimation(shown);
  }, [startedAt, acceptMs, now, accepted, theme.reduceMotion, theme.motion.duration.base, shown]);
  const ring = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - shown.value) }));
  return (
    <View
      testID="kitchen-card"
      style={{ alignSelf: 'stretch', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.accentTint, borderRadius: theme.radius['2xl'], paddingVertical: theme.space[6], paddingHorizontal: theme.space[4] }}
    >
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={accepted ? t('kitchen.ring_accepted_a11y') : t('kitchen.ring_waiting_a11y')}
        style={{ width: RING, height: RING, alignItems: 'center', justifyContent: 'center' }}
      >
        <Svg width={RING} height={RING} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={theme.colors.surface} strokeWidth={RING_STROKE} fill="none" />
          <AnimatedCircle cx={RING / 2} cy={RING / 2} r={r} stroke={theme.colors.deal} strokeWidth={RING_STROKE} strokeLinecap="round" fill="none" strokeDasharray={`${length} ${length}`} animatedProps={ring} />
        </Svg>
        <View style={{ width: RING - 26, height: RING - 26, borderRadius: (RING - 26) / 2, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
          <FoodArt {...art} stage={theme.colors.surface} />
        </View>
        {accepted ? (
          <Animated.View
            testID="kitchen-accepted-ring"
            entering={theme.reduceMotion ? undefined : ZoomIn.springify().damping(theme.motion.spring.celebrate.damping).stiffness(theme.motion.spring.celebrate.stiffness)}
            style={{ position: 'absolute', bottom: 0, end: 4, width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.inverse, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="check" size={22} color="onInverse" strokeWidth={3} />
          </Animated.View>
        ) : null}
      </View>
      {children}
    </View>
  );
}
