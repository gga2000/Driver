import { View } from 'react-native';
import type { CartCard } from '@driver/contracts';
import { Icon, useTheme } from '@driver/ui';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';
import { cartPhoto } from './look';
import { cartPalette } from './palette';

/**
 * The cart's photo, or for a cart with none a cream tile with its colour's food mark. Round for the
 * followed strip (`round`), with the fuchsia ring while the cart is open; square-ish in a row; `wide` fills its parent edge to edge (the cart page's hero).
 */
export function CartPhoto({ card, size, round = false, wide = false, testID }: { card: Pick<CartCard, 'kind' | 'dishes' | 'open'>; size: number; round?: boolean; wide?: boolean; testID?: string }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const photo = cartPhoto(card);
  const radius = round ? size / 2 : wide ? 0 : theme.radius.lg;
  const width = wide ? ('100%' as const) : size;
  const ring = round ? 3 : 0;
  const inner = size - ring * 4;
  return (
    <View
      testID={testID}
      style={{
        width,
        height: size,
        borderRadius: radius,
        padding: ring,
        borderWidth: round ? ring : 0,
        borderColor: round ? (card.open ? pal.ring : theme.colors.border) : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View style={{ width: round ? inner : width, height: round ? inner : size, borderRadius: round ? inner / 2 : radius, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', opacity: card.open || round ? 1 : 0.85 }}>
        {photo !== null ? <FoodPhoto photo={photo} style={{ width: '100%', height: '100%' }} /> : <Icon name="food" size={Math.round(size * 0.38)} color={pal.text} />}
      </View>
    </View>
  );
}
