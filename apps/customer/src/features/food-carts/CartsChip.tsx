import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { cartPalette } from './palette';
import { useCarts } from './queries';

/**
 * «عربانات فاتحة هسة · 3» on the food page, under the four doors (Ali 2026-10-12: carts open, both
 * doors). Shows only while carts are open in the city and at least one is open now; nothing while
 * loading or on an error, so the page never jumps.
 */
export function CartsChip() {
  const theme = useTheme();
  const t = useT();
  const pal = cartPalette(theme);
  const carts = useCarts(null);
  const n = carts.data?.launched ? carts.data.open.length : 0;
  if (n === 0) return null;
  return (
    <Pressable
      testID="food-carts-chip"
      accessibilityRole="link"
      accessibilityLabel={`${t('carts.title')}، ${t('carts.show_open', { n })}`}
      onPress={() => router.push('/food-carts')}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.pill,
        borderWidth: 1.5,
        borderColor: pal.fill,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
      })}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: pal.ring }} />
      <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
        {t('carts.title')}
      </Text>
      <Text variant="label" weight={700} tabular style={{ color: pal.text }}>
        {t('carts.show_open', { n })}
      </Text>
      <Icon name="chevron-forward" size={18} color={theme.colors.textMuted} />
    </Pressable>
  );
}
