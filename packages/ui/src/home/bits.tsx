import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { useHomeLook } from './look';

/** The header's points corner: points only («120 نقطة», Ali 2026-11-02); nothing at 0. */
export function PointsPill({ points, onPress, testID }: { points: number; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  if (points <= 0) return null;
  const label = t('unit.points', { n: points });
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={t('home.points_a11y', { points: label })}
      onTouchEnd={onPress}
      style={{
        minHeight: theme.hitTarget,
        justifyContent: 'center',
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: look.edge,
        backgroundColor: theme.colors.surface,
      }}
    >
      <Text variant="label" face="display" compact numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The Tigris line in the page's end margin (spec §3 item 11, thicker in round 3). During an order it fills
 * orange from the top as the order moves forward (`riverFill`). Decorative, hidden from screen readers.
 */
export function RiverLine({ fill = 0, style, testID }: { fill?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const f = Math.max(0, Math.min(1, fill));
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width: 5, borderRadius: 3, overflow: 'hidden', backgroundColor: look.river.line, boxShadow: look.river.glow ?? undefined, opacity: theme.scheme === 'dark' ? 0.7 : 1 }, style]}
    >
      {f > 0 ? <View testID={testID ? `${testID}-fill` : undefined} style={{ height: `${f * 100}%`, backgroundColor: theme.colors.accent }} /> : null}
    </View>
  );
}
