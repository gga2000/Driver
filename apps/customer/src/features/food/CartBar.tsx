import { View } from 'react-native';
import { AnimatedPressable, Icon, Text, usePressScale, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/** The floating "شوف السلة · total" bar over the menu: item count bubble, total, chevron. */
export function CartBar({ count, totalIqd, onPress }: { count: number; totalIqd: number; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const press = usePressScale(0.97);
  return (
    <AnimatedPressable
      testID="cart-bar"
      accessibilityRole="button"
      accessibilityLabel={t('restaurant.view_cart', { amount: amountParam(totalIqd) })}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 58,
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.pill,
          backgroundColor: theme.colors.accent,
          shadowColor: theme.colors.shadow,
          shadowOpacity: theme.elevation[3].shadowOpacity,
          shadowRadius: theme.elevation[3].shadowRadius,
          shadowOffset: theme.elevation[3].shadowOffset,
          elevation: theme.elevation[3].elevation,
        },
        press.style,
      ]}
    >
      <View style={{ minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 8, backgroundColor: theme.colors.onAccent, alignItems: 'center', justifyContent: 'center' }}>
        <Text variant="label" weight={700} color="accent" tabular>
          {count}
        </Text>
      </View>
      <Text variant="button" color="onAccent" style={{ flex: 1 }} numberOfLines={1}>
        {t('restaurant.view_cart', { amount: amountParam(totalIqd) })}
      </Text>
      <Icon name="chevron-forward" size={20} color="onAccent" strokeWidth={2.2} />
    </AnimatedPressable>
  );
}
