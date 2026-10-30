import { View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';

/**
 * The marks the road map draws over the map (N13 «طريق بغداد»): the car as the driver's initial in a
 * saffron ring, its tag («عديتوا بسماية · باقي 38 دقيقة»), a town's chip, and the window view's card
 * on the horizon. Same on the web (placed from MapLibre's projection) and on phones (map markers).
 */

const SHADOW = '0 2px 8px rgba(40,24,8,0.22)';

/** The car: the driver's initial on cream inside a saffron ring (the minibus when his name is not known). */
export function CarPin({ initial, size = 44 }: { initial: string; size?: number }) {
  const theme = useTheme();
  return (
    <View
      testID="road-car-pin"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: Math.round(size / 11),
        borderColor: theme.colors.accent,
        backgroundColor: theme.colors.accentTint,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 0 0 2px ${theme.colors.surface}, ${SHADOW}`,
      }}
    >
      {initial ? (
        <Text variant={size >= 40 ? 'title' : 'label'} weight={700} color="accentText" compact style={{ direction: 'rtl' }}>
          {initial}
        </Text>
      ) : (
        <Icon name="rajaa" size={Math.round(size * 0.45)} color="accentText" strokeWidth={2.2} />
      )}
    </View>
  );
}

/** The car's tag: a small line over a bold one. */
export function CarTag({ top, bottom }: { top: string; bottom: string }) {
  const theme = useTheme();
  return (
    <View testID="road-car-tag" style={{ paddingHorizontal: theme.space[3], paddingVertical: 6, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, boxShadow: SHADOW, direction: 'rtl', maxWidth: 170 }}>
      <Text variant="caption" color="textMuted" numberOfLines={1} compact>
        {top}
      </Text>
      <Text variant="label" weight={700} numberOfLines={1} compact tabular>
        {bottom}
      </Text>
    </View>
  );
}

/** A town's chip; the next one (and the end of the road) dark, the ones behind muted. */
export function TownChip({ name, tone }: { name: string; tone: 'next' | 'end' | 'ahead' | 'passed' }) {
  const theme = useTheme();
  const dark = tone === 'next' || tone === 'end';
  return (
    <View
      style={{
        paddingHorizontal: theme.space[2] + 2,
        paddingVertical: 3,
        borderRadius: theme.radius.pill,
        backgroundColor: dark ? theme.colors.inverse : theme.colors.surface,
        boxShadow: SHADOW,
        direction: 'rtl',
      }}
    >
      <Text variant={dark ? 'label' : 'footnote'} weight={dark ? 700 : 600} color={dark ? 'onInverse' : tone === 'passed' ? 'textMuted' : 'text'} numberOfLines={1} compact>
        {name}
      </Text>
    </View>
  );
}

/** The window view's card on the horizon: «الجاية» over «جسر ديالى · 11 دقيقة». */
export function HorizonCard({ eyebrow, title }: { eyebrow: string; title: string }) {
  const theme = useTheme();
  return (
    <View testID="road-horizon" style={{ alignItems: 'center', paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], borderRadius: theme.radius.md, backgroundColor: theme.colors.surface, boxShadow: SHADOW, direction: 'rtl' }}>
      <Text variant="caption" color="textMuted" compact>
        {eyebrow}
      </Text>
      <Text variant="bodyStrong" weight={700} numberOfLines={1} compact tabular>
        {title}
      </Text>
    </View>
  );
}
