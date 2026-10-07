import { useEffect, useRef, useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { ThemeColorKey, TypeVariant } from '@driver/design-tokens';
import type { Locale } from '@driver/i18n';
import { departureParts, departureTickMs, flapCells } from '../logic/departure';
import { useNow } from '../network/network';
import { withAlpha } from '../theme/color';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type DepartureTimeSize = 'compact' | 'card' | 'hero';
/**
 * `ink`: the garage board (ink tiles, cream digits). `warning` / `success` for a late or done time.
 * `quiet` for dense lists. `live`: something on the move (the food ETA box, joy J5b) — kashi in the
 * customer's Istikan theme, the accent text colour in light/dark.
 */
export type DepartureTimeTone = 'ink' | 'warning' | 'success' | 'quiet' | 'live';

export interface DepartureTimeProps {
  /** The departure (or the ETA, which reads like one). */
  at: Date | number;
  /** Clock override (tests, the gallery, a screen that already ticks). Default: ticks by itself. */
  now?: number;
  size?: DepartureTimeSize;
  /** Eyebrow above the time: "تطلع", "يوصلك", "المحطة الجاية". */
  label?: string;
  /** "بعد 52 دقيقة" under the time (default on; only for today and tomorrow). */
  countdown?: boolean;
  /** A line in place of the countdown ("أو من تكمل · آخر وقت 8:00 م"). */
  note?: string;
  /** The note as news, not a footnote: "الصعود بدأ" in the accent (default muted). */
  noteTone?: 'muted' | 'accent';
  tone?: DepartureTimeTone;
  /** Say «اليوم» too, and the part of day in words («6:15 المسا»): the boarding pass (R-06). */
  passStyle?: boolean;
  /** Colour the line under the time as a warning once the time has passed (default on). */
  pastWarning?: boolean;
  align?: 'start' | 'center';
  locale?: Locale;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface Metrics {
  font: TypeVariant;
  w: number;
  h: number;
  gap: number;
  radius: number;
  colonW: number;
  period: TypeVariant;
  sub: TypeVariant;
  eyebrow: TypeVariant;
}

const METRICS: Record<DepartureTimeSize, Metrics> = {
  // 26/700 in a 36 px tile: the food ETA box and list rows.
  compact: { font: 'amount', w: 20, h: 36, gap: 2, radius: 5, colonW: 8, period: 'label', sub: 'caption', eyebrow: 'caption' },
  // 34/700 (audit d-2): home's الرجعة card, khat stops, the boarding pass.
  card: { font: 'numeralSm', w: 26, h: 46, gap: 3, radius: 6, colonW: 10, period: 'title', sub: 'footnote', eyebrow: 'caption' },
  // 44/700: the departure hero (partner garage page, boarding pass header).
  hero: { font: 'numeralMd', w: 34, h: 60, gap: 4, radius: 8, colonW: 12, period: 'heading', sub: 'label', eyebrow: 'label' },
};

const TILE: Record<DepartureTimeTone, { tile: ThemeColorKey; digit: ThemeColorKey }> = {
  ink: { tile: 'text', digit: 'bg' },
  warning: { tile: 'warningText', digit: 'surface' },
  success: { tile: 'successText', digit: 'surface' },
  quiet: { tile: 'surfaceSunken', digit: 'text' },
  live: { tile: 'liveText', digit: 'surface' },
};

/** One split-flap cell: on a change the new digit drops in from the top hinge as the old one falls away. */
function FlapCell({ char, m, tone }: { char: string; m: Metrics; tone: DepartureTimeTone }) {
  const theme = useTheme();
  const c = TILE[tone];
  const shown = useRef(char);
  const [prev, setPrev] = useState<string | null>(null);
  const p = useSharedValue(1);

  useEffect(() => {
    if (char === shown.current) return;
    const old = shown.current;
    shown.current = char;
    if (theme.reduceMotion) {
      setPrev(null);
      return;
    }
    setPrev(old);
    p.value = 0;
    p.value = withTiming(1, { duration: theme.motion.duration.flap, easing: Easing.out(Easing.quad) }, (done) => {
      if (done) runOnJS(setPrev)(null);
    });
  }, [char, theme.reduceMotion, theme.motion.duration.flap, p]);

  const incoming = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * -m.h * 0.45 }, { scaleY: 0.4 + 0.6 * p.value }],
  }));
  const outgoing = useAnimatedStyle(() => ({
    opacity: 1 - p.value,
    transform: [{ translateY: p.value * m.h * 0.45 }, { scaleY: 1 - 0.6 * p.value }],
  }));

  const digit = (s: string, anim: typeof incoming | null) => (
    <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }, anim]}>
      <Text variant={m.font} color={c.digit} tabular style={{ lineHeight: m.h, textAlign: 'center' }}>
        {s}
      </Text>
    </Animated.View>
  );

  return (
    <View style={{ width: m.w, height: m.h, borderRadius: m.radius, backgroundColor: theme.colors[c.tile], overflow: 'hidden' }}>
      {prev !== null ? digit(prev, outgoing) : null}
      {digit(char, prev !== null ? incoming : null)}
      {/* The split of the flap: a hairline across the middle of the tile. */}
      <View style={{ position: 'absolute', left: 0, right: 0, top: m.h / 2 - 0.5, height: 1, backgroundColor: withAlpha(theme.colors[c.digit], tone === 'quiet' ? 0.12 : 0.22) }} />
    </View>
  );
}

/**
 * The garage-board time (customer audit d-2): Driver's signature motif. Big tabular digits on
 * split-flap tiles, the part of day (ص/م), the day when it is not today ("باچر"), and a countdown
 * ("بعد 52 دقيقة"). A changed digit flips (180 ms); under reduce motion it simply changes. Always the
 * city's clock (Asia/Baghdad). Used for الرجعة departures, khat stops and the food ETA ("يوصلك"),
 * so ETAs read like departures. The whole thing is one accessible text: "7:05 م، باچر، بعد 52 دقيقة".
 */
export function DepartureTime({ at, now, size = 'card', label, countdown = true, note, noteTone = 'muted', tone = 'ink', passStyle = false, pastWarning = true, align = 'start', locale = 'ar-IQ', style, testID = 'departure-time' }: DepartureTimeProps) {
  const theme = useTheme();
  const m = METRICS[size];
  const atMs = typeof at === 'number' ? at : at.getTime();
  // Its own clock when the screen gives none: every 15 s near the time, every minute further out.
  const ticking = useNow(now === undefined, departureTickMs(atMs, Date.now()));
  const parts = departureParts(atMs, now ?? ticking, { locale, countdown, alwaysDay: passStyle, partOfDay: passStyle });
  const sub = [parts.day, note ?? parts.countdown].filter(Boolean).join(' · ');
  const centered = align === 'center';
  const spoken = [label, parts.label, note].filter(Boolean).join('، ');

  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={spoken} style={[{ gap: size === 'compact' ? 2 : theme.space[1], alignItems: centered ? 'center' : 'flex-start' }, style]}>
      {label ? (
        <Text variant={m.eyebrow} weight={600} color="textMuted" importantForAccessibility="no-hide-descendants">
          {label}
        </Text>
      ) : null}
      <View importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', alignItems: 'center', gap: size === 'hero' ? theme.space[2] : 6 }}>
        {/* Digits read left to right inside Arabic, like every clock. */}
        <View testID={`${testID}-digits`} style={{ flexDirection: 'row', alignItems: 'center', gap: m.gap, direction: 'ltr' }}>
          {flapCells(parts.digits).map((cell) =>
            cell.colon ? (
              <View key={cell.key} style={{ width: m.colonW, alignItems: 'center' }}>
                <Text variant={m.font} color="text" style={{ lineHeight: m.h }}>
                  :
                </Text>
              </View>
            ) : (
              <FlapCell key={cell.key} char={cell.char} m={m} tone={tone} />
            ),
          )}
        </View>
        <Text variant={m.period} weight={700} color="text">
          {parts.period}
        </Text>
      </View>
      {sub ? (
        <Text
          testID={`${testID}-sub`}
          variant={m.sub}
          weight={note && noteTone === 'accent' ? 700 : 600}
          color={parts.past && pastWarning ? 'warningText' : note && noteTone === 'accent' ? 'accentText' : 'textMuted'}
          tabular
          importantForAccessibility="no-hide-descendants"
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}
