import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { cartPalette } from './palette';
import { useCarts } from './queries';

/**
 * The carts card for home's «وعدنا هم» group (the home thread mounts it; Ali 2026-10-12: carts open,
 * both doors). Solid fuchsia, a live line of how many are open and one name. Renders only while carts
 * are open in the city and at least one is open now; nothing while loading or on an error.
 */
export function HomeCartsCard() {
  const theme = useTheme();
  const t = useT();
  const pal = cartPalette(theme);
  const carts = useCarts(null);
  const open = carts.data?.launched ? carts.data.open : [];
  if (open.length === 0) return null;
  const first = open[0]!;
  return (
    <Pressable
      testID="home-carts-card"
      accessibilityRole="link"
      accessibilityLabel={`${t('carts.title')}، ${t('carts.home_live', { n: open.length, name: first.name })}`}
      onPress={() => router.push('/food-carts')}
      style={({ pressed }) => ({
        minHeight: 88,
        borderRadius: theme.radius.xl,
        padding: theme.space[4],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        backgroundColor: pal.fill,
        transform: [{ scale: pressed && !theme.reduceMotion ? 0.98 : 1 }],
      })}
    >
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <Text variant="title" face="display" style={{ color: pal.on }}>
          {t('carts.title')}
        </Text>
        <Text variant="label" style={{ color: pal.on }} numberOfLines={2}>
          {t('carts.home_live', { n: open.length, name: first.name })}
        </Text>
      </View>
      <Icon name="chevron-forward" size={22} color={pal.on} />
    </Pressable>
  );
}
