import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@driver/i18n';
import { Text } from '../components/Text';
import { useTheme } from '../theme/ThemeProvider';
import { homeSize } from './format';
import { useHomeLook } from './look';
import { HomePress } from './media';

/** The header's points corner: points only («120 نقطة», Ali 2026-11-02); nothing at 0. */
export function PointsPill({ points, onPress, testID }: { points: number; onPress?: () => void; testID?: string }) {
  const theme = useTheme();
  if (points <= 0) return null;
  const label = t('unit.points', { n: points });
  // Audit round 3: a flat, quiet chip that never outweighs the wordmark; the tap area stays 44.
  const body = (
    <View style={{ height: 32, justifyContent: 'center', paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken }}>
      <Text variant="label" face="display" weight={600} compact numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
  const box = { minHeight: theme.hitTarget, justifyContent: 'center' as const };
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={t('home.points_a11y', { points: label })} style={box}>
        {body}
      </View>
    );
  }
  return (
    <HomePress testID={testID} accessibilityLabel={t('home.points_a11y', { points: label })} onPress={onPress} style={box}>
      {body}
    </HomePress>
  );
}

/** The emerald river glows at night; a touch of transparency keeps it behind the cards. */
const RIVER_NIGHT_OPACITY = 0.7;

/**
 * The Tigris line (spec §3 item 11). Audit round 2: a thin line beside the map card during an order only,
 * filling orange as the order moves forward (`riverFill`), so it never reads as a scroll bar. Decorative,
 * hidden from screen readers.
 */
export function RiverLine({ fill = 0, style, testID }: { fill?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  const look = useHomeLook();
  const f = Math.max(0, Math.min(1, fill));
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ pointerEvents: 'none', width: homeSize.river, borderRadius: homeSize.river / 2, overflow: 'hidden', backgroundColor: look.river.line, boxShadow: look.river.glow ?? undefined, opacity: theme.scheme === 'dark' ? RIVER_NIGHT_OPACITY : 1 }, style]}
    >
      {f > 0 ? <View testID={testID ? `${testID}-fill` : undefined} style={{ height: `${f * 100}%`, backgroundColor: theme.colors.accent }} /> : null}
    </View>
  );
}
