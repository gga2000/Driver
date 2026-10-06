import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { OrderTracking } from '@driver/contracts';
import { formatClock, Icon, Text, useTheme, useToast, withAlpha } from '@driver/ui';
import { color } from '@driver/design-tokens';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { creditToastDue, etaPastDeadline, promiseBar, promiseCopy } from './late-promise';

/** Orders whose "رجعنالك … رصيد" toast this app run already showed. */
const toasted = new Set<string>();

/**
 * Audit d-5: when the server posts the honest-delay credit, say so once — warm, not grovelling:
 * "رجعنالك 1,000 دينار رصيد. آسفين على التأخير" ("حطينالك …" for a free-delivery order).
 */
export function useLatePromiseToast(view: OrderTracking | undefined): void {
  const toast = useToast();
  const t = useT();
  const orderId = view?.order.id ?? '';
  const p = view?.latePromise;
  useEffect(() => {
    if (!orderId || !creditToastDue(toasted, orderId, p)) return;
    toasted.add(orderId);
    toast.show({ message: t(promiseCopy(p!.basis).toast, { amount: amountParam(p!.credit!.amountIqd) }), tone: 'success', icon: 'gift' }, 6000);
  }, [orderId, p, toast, t]);
}

/**
 * The running-late banner over the map (customer spec §4 degraded states): how late, the new time,
 * and — when the order carries the honest-delay promise — a thin bar from the promised time to the
 * server's threshold with the deadline as a clock time. Once the server sent its apology (promised
 * time + `apologyAfterMin`, the same words as the push) the headline says sorry; once the credit is
 * posted the bar turns green and says what came back.
 *
 * Joy S2-02 / f17: it is an inverse banner (ink, cream text, a saffron clock), never a tint, so a
 * delay can't be mistaken for the brand's active-order card.
 */
export function LateBanner({ view, lateMin, eta, now }: { view: OrderTracking; lateMin: number; eta: Date; now: number }) {
  const theme = useTheme();
  const t = useT();
  const bar = promiseBar(view.latePromise, now);
  const fill = useSharedValue(bar?.progress ?? 0);
  useEffect(() => {
    const to = bar?.progress ?? 0;
    fill.value = theme.reduceMotion ? to : withTiming(to, { duration: theme.motion.duration.base });
  }, [bar?.progress, fill, theme.reduceMotion, theme.motion.duration.base]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.round(fill.value * 1000) / 10}%` }));
  const credited = Boolean(bar?.credited);
  const past = etaPastDeadline(bar, eta);
  const copy = bar ? promiseCopy(bar.basis) : null;
  const tone = credited ? theme.colors.onInverseSuccess : theme.colors.onInverseCaution;
  return (
    <View
      testID="running-late"
      accessibilityRole="alert"
      style={{
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        paddingVertical: theme.space[2],
        borderRadius: theme.radius.lg,
        backgroundColor: theme.colors.inverse,
        shadowColor: color.neutral[1000],
        shadowOpacity: 0.16,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="clock" size={20} color="onInverseCaution" strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={700} color="onInverse">
            {bar?.apologized ? t('promise.apology_title') : t('track.running_late', { minutes: lateMin })}
          </Text>
          <Text variant="caption" color="onInverseMuted">
            {t('track.note_late', { minutes: lateMin, time: formatClock(eta) })}
          </Text>
        </View>
      </View>
      {bar && copy ? (
        <View
          testID="late-promise"
          accessible
          accessibilityLabel={`${credited ? t(copy.credited, { amount: amountParam(bar.amountIqd) }) : t(past ? copy.barPast : copy.barUntil, { time: formatClock(bar.deadlineAt), amount: amountParam(bar.amountIqd) })}. ${t('promise.bar_a11y', { elapsed: bar.elapsedMin, minutes: bar.afterMin })}`}
          style={{ gap: theme.space[1] }}
        >
          <View style={{ height: 6, borderRadius: 3, backgroundColor: withAlpha(tone, 0.25), overflow: 'hidden' }}>
            <Animated.View style={[{ height: 6, borderRadius: 3, backgroundColor: tone }, fillStyle]} />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
            {credited ? <Icon name="check" size={14} color="onInverseSuccess" strokeWidth={2.4} /> : null}
            <Text variant="caption" weight={600} color={credited ? 'onInverseSuccess' : 'onInverse'} tabular testID={credited ? 'late-promise-credited' : 'late-promise-until'} style={{ flexShrink: 1 }}>
              {credited ? t(copy.credited, { amount: amountParam(bar.amountIqd) }) : t(past ? copy.barPast : copy.barUntil, { time: formatClock(bar.deadlineAt), amount: amountParam(bar.amountIqd) })}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
