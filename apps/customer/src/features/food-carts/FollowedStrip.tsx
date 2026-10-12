import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import type { CartCard } from '@driver/contracts';
import { Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { CartPhoto } from './CartPhoto';
import { cartPalette } from './palette';
import { cartStatusShort } from './status';

const SIZE = 76;

/**
 * «اللي تتابعها»: the carts this person follows, as round photos (open ones first, ringed in fuchsia)
 * with a word under each: «فاتح», its usual hour, or its away note. A tap opens the cart.
 */
export function FollowedStrip({ cards }: { cards: readonly CartCard[] }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const locale = useLocale();
  if (cards.length === 0) return null;
  const sorted = [...cards].sort((a, b) => Number(b.open) - Number(a.open));
  return (
    <View style={{ gap: theme.space[2] }} testID="carts-followed">
      <Text variant="section" face="display">
        {t('carts.followed_title')}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[3], paddingVertical: theme.space[1] }}>
        {sorted.map((c) => (
          <Pressable
            key={c.id}
            testID={`carts-followed-${c.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}، ${cartStatusShort(t, c, locale)}`}
            onPress={() => router.push({ pathname: '/food-carts/[id]', params: { id: c.id } })}
            style={{ width: SIZE + 12, alignItems: 'center', gap: 4 }}
          >
            <CartPhoto card={c} size={SIZE} round />
            <Text variant="caption" weight={600} numberOfLines={1} align="center">
              {c.name}
            </Text>
            <Text variant="caption" numberOfLines={1} align="center" tabular color={c.open ? pal.text : 'textMuted'} style={{ marginTop: -4 }}>
              {cartStatusShort(t, c, locale)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
