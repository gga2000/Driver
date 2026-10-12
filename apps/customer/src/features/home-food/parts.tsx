import { memo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Text, useTheme, type IconName } from '@driver/ui';

/**
 * أكل بيت's small shared pieces: the pomegranate colours, her letter instead of a face, the plates-left
 * dots, the count pills on a kitchen card and the portion pill beside a dish name.
 */

/** Pomegranate (دبس الرمان) for this theme: the fill, the ink on cream and on cards, and the pale wash. */
export function usePom() {
  const theme = useTheme();
  const s = theme.services.home;
  const dark = theme.scheme === 'dark';
  return { fill: s.fill, on: s.on, wash: s.card.bg, ink: dark ? s.card.dot : s.fill, sub: s.card.sub };
}

/** Her letter on a pomegranate tile: a kitchen never shows a face. */
export const Monogram = memo(function Monogram({ letter, size = 56 }: { letter: string; size?: number }) {
  const pom = usePom();
  return (
    <View
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: pom.fill, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text face="display" fixed color={pom.on} style={{ fontSize: size * 0.46, lineHeight: size * 0.62 }}>
        {letter}
      </Text>
    </View>
  );
});

/**
 * Plates left as a row of small plates (filled = still free), when she cooked ten or fewer (more don't
 * fit beside the count); the words carry the count for screen readers and for bigger pots.
 */
export function PlateDots({ total, left, label, testID }: { total: number; left: number; label: string; testID?: string }) {
  const theme = useTheme();
  const pom = usePom();
  const out = left === 0;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} accessible accessibilityLabel={label} testID={testID}>
      <Text variant="caption" weight={700} color={out ? 'textMuted' : pom.ink} tabular numberOfLines={1} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      {total > 0 && total <= 10 ? (
        <View style={{ flexDirection: 'row', gap: 2, flexShrink: 1, overflow: 'hidden' }} aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <View
              key={i}
              style={{
                width: 8,
                height: 8,
                borderRadius: 5,
                borderWidth: 1.5,
                borderColor: i < left ? pom.fill : theme.colors.borderStrong,
                backgroundColor: i < left ? pom.fill : 'transparent',
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** A count pill on a kitchen card: «3 جاهزة هسه» in green, «2 بالحجز» in pomegranate. */
export function CountPill({ icon, label, tone }: { icon: IconName; label: string; tone: 'ready' | 'reserve' }) {
  const theme = useTheme();
  const pom = usePom();
  const bg = tone === 'ready' ? theme.colors.successTint : pom.wash;
  const fg = tone === 'ready' ? theme.colors.successText : pom.ink;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: bg, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[3], minHeight: 30 }}>
      <Icon name={icon} size={16} color={fg} />
      <Text variant="caption" weight={700} color={fg} compact>
        {label}
      </Text>
    </View>
  );
}

/** «يشبّع 2» or «5 قطع» beside a dish name. */
export function PortionPill({ label, style }: { label: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.sm, paddingHorizontal: theme.space[2], minHeight: 24, justifyContent: 'center' }, style]}>
      <Text variant="caption" weight={600} color="textMuted" compact numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
