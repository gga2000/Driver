import { Pressable, View } from 'react-native';
import { formatIqd, Icon, Text, useTheme } from '@driver/ui';
import { useShopping } from './palette';

/**
 * The shopping side's main button, pinned over the bottom of a screen: leaf green, white words, the
 * amount, and a cream circle with the arrow. One look on every shopping screen.
 */
export function GreenBar({
  label,
  amountIqd,
  onPress,
  a11y,
}: {
  label: string;
  amountIqd?: number;
  onPress: () => void;
  a11y?: string;
}) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y ?? (amountIqd != null ? `${label}، ${formatIqd(amountIqd)}` : label)}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 58,
        borderRadius: theme.radius.pill,
        backgroundColor: shop.fill,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingStart: theme.space[5],
        paddingEnd: theme.space[2],
        transform: [{ scale: pressed ? 0.98 : 1 }],
        shadowColor: theme.elevation[2].shadowColor,
        shadowOpacity: theme.elevation[2].shadowOpacity,
        shadowRadius: theme.elevation[2].shadowRadius,
        shadowOffset: theme.elevation[2].shadowOffset,
        elevation: theme.elevation[2].elevation,
      })}
    >
      <Text variant="button" numberOfLines={1} style={{ color: shop.on, flexShrink: 1 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        {amountIqd != null ? (
          <Text variant="button" tabular style={{ color: shop.on }}>
            {formatIqd(amountIqd)}
          </Text>
        ) : null}
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: theme.colors.bg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrow-forward" size={18} color={theme.colors.text} />
        </View>
      </View>
    </Pressable>
  );
}
