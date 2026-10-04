import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { CAP_WARN_SHARE } from '@driver/contracts';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { Glyph } from './Glyph';
import { cashTruth, type CashTruth } from './logic';

/**
 * One cash truth (UI/UX audit P-05): the same "لازم تسلّم" number on home, the earnings card, the
 * hand-over sheet and the job-done screen. The bar's length and colour both come from that number
 * against the cap (amber from 70 %, red from 90 % or over the cap — design tokens only); what he holds
 * is a secondary line that explains the difference (his own pay stays with him); the note says when
 * offers stop. `hero` is the earnings card's large figure, `compact` the home sheet and done screen.
 */
export function CashMeter({
  owedIqd,
  heldIqd,
  capIqd,
  overCap,
  size = 'compact',
  note = true,
  testID = 'cash-meter',
}: {
  owedIqd: number;
  heldIqd: number;
  capIqd: number;
  overCap: boolean;
  size?: 'compact' | 'hero';
  note?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const c = cashTruth({ owedIqd, heldIqd, capIqd, overCap });
  const fill = theme.colors[c.tone];
  const amountColor = c.tone === 'danger' ? 'dangerText' : c.tone === 'warning' ? 'warningText' : 'text';
  const grow = useSharedValue(theme.reduceMotion ? c.share : 0);
  useEffect(() => {
    grow.value = theme.reduceMotion ? c.share : withTiming(c.share, { duration: 700, easing: Easing.out(Easing.cubic) });
  }, [c.share, grow, theme.reduceMotion]);
  const bar = useAnimatedStyle(() => ({ width: `${Math.max(grow.value > 0 ? 3 : 0, grow.value * 100)}%` }));
  const hero = size === 'hero';
  const barH = hero ? 14 : 10;
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: theme.space[2] }}>
        <View style={{ flexShrink: 1 }}>
          <Text variant={hero ? 'footnote' : 'caption'} color="textMuted">
            {t('partner.must_hand_over')}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text testID={`${testID}-owed`} variant={hero ? 'amount' : 'title'} weight={700} tabular color={amountColor}>
              {amountParam(owedIqd)}
            </Text>
            <Text variant="label" color="textMuted">
              {t('quote.currency')}
            </Text>
          </View>
        </View>
        <Text variant="caption" weight={600} color="textMuted" tabular style={{ marginBottom: hero ? 8 : 4 }}>
          {t('partner.cap_of', { cap: amountParam(capIqd) })}
        </Text>
      </View>
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: capIqd, now: Math.min(owedIqd, capIqd) }}
        style={{ height: barH, borderRadius: barH / 2, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}
      >
        <Animated.View style={[{ height: barH, borderRadius: barH / 2, backgroundColor: fill }, bar]} />
        {/* Where the warning starts (70 %): the courier sees how close the amber zone is. */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: `${CAP_WARN_SHARE * 100}%`, width: 2, backgroundColor: theme.colors.surface }} />
      </View>
      {c.heldNote ? (
        <Text testID={`${testID}-held`} variant="caption" color="textMuted" tabular>
          {c.heldNote.kind === 'own'
            ? t('partner.held_split', { held: amountParam(heldIqd), own: amountParam(c.heldNote.amountIqd) })
            : t('partner.held_more', { held: amountParam(heldIqd), extra: amountParam(c.heldNote.amountIqd) })}
        </Text>
      ) : null}
      {note ? <CashNote truth={c} testID={`${testID}-note`} /> : null}
    </View>
  );
}

/** When offers stop: over the cap (stopped), close to it (how much is left), or fine. */
export function CashNote({ truth, testID }: { truth: CashTruth; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const urgent = truth.tone !== 'success';
  const color = truth.tone === 'danger' ? 'dangerText' : truth.tone === 'warning' ? 'warningText' : 'textMuted';
  const glyph = truth.tone === 'danger' ? 'dangerText' : 'warningText';
  const text = truth.over
    ? t('partner.cap_over_body', { amount: amountParam(truth.overIqd) })
    : urgent
      ? t('partner.cap_near_body', { amount: amountParam(truth.leftIqd) })
      : t('partner.cash_remaining', { amount: amountParam(truth.leftIqd) });
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
      <View style={{ marginTop: 3 }}>{urgent ? <Glyph name="alert" size={16} color={glyph} /> : <Icon name="check" size={16} color="successText" strokeWidth={2.6} />}</View>
      <Text testID={testID} variant="footnote" weight={urgent ? 600 : 400} color={color} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
