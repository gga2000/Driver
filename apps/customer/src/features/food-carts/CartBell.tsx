import { Pressable } from 'react-native';
import type { CartCard } from '@driver/contracts';
import { Icon, useTheme, useToast } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { requireSignIn } from '@/lib/guest';
import { useSignedIn } from '@/lib/session';
import { cartPalette } from './palette';
import { useFollowCart } from './queries';

/**
 * «تابع»: the bell on a cart. Filled ink with the cart's fuchsia bell while followed; a tap flips it and
 * says what happens (one push when it opens, at most once a day). A guest's tap goes to the phone
 * number first: following needs someone to tell.
 */
export function CartBell({ card, size = 44, returnTo = '/food-carts', testID }: { card: Pick<CartCard, 'id' | 'name' | 'following'>; size?: 44 | 52; returnTo?: string; testID?: string }) {
  const theme = useTheme();
  const pal = cartPalette(theme);
  const t = useT();
  const toast = useToast();
  const signedIn = useSignedIn();
  const follow = useFollowCart();
  const on = card.following;
  const press = () => {
    if (!signedIn) {
      toast.show({ message: t('carts.guest_follow'), tone: 'neutral', icon: 'bell' });
      void requireSignIn(returnTo);
      return;
    }
    theme.haptic('selection');
    follow.mutate(
      { cartId: card.id, on: !on },
      {
        onSuccess: () => toast.show({ message: on ? t('carts.unfollowed_toast', { name: card.name }) : t('carts.followed_toast', { name: card.name }), tone: 'success', icon: 'bell' }),
        onError: () => toast.show({ message: t('carts.follow_failed'), tone: 'danger' }),
      },
    );
  };
  return (
    <Pressable
      testID={testID ?? `cart-bell-${card.id}`}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, busy: follow.isPending }}
      accessibilityLabel={on ? t('carts.unfollow_a11y', { name: card.name }) : t('carts.follow_a11y', { name: card.name })}
      disabled={follow.isPending}
      onPress={press}
      hitSlop={4}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? theme.colors.inverse : theme.colors.surfaceSunken,
        transform: [{ scale: pressed && !theme.reduceMotion ? 0.94 : 1 }],
      })}
    >
      <Icon name="bell" size={size === 52 ? 24 : 20} color={on ? pal.ring : theme.colors.text} />
    </Pressable>
  );
}
