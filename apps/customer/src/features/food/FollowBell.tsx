import { IconButton, useToast } from '@driver/ui';
import { useFollowDish } from '@/features/home/habit-queries';
import { useT } from '@/lib/i18n';
import { useSignedIn } from '@/lib/session';

/**
 * «خبرني لمن يطبخوه» (joy h2): the bell on a pot or dish. Filled while the person follows it; a tap
 * flips it and says what will happen (one push on that dish's day, at most one a day). Guests have no
 * account to tell, so they see no bell.
 */
export function FollowBell({ merchantOrgId, itemId, dish, restaurant, followed, testID }: { merchantOrgId: string; itemId: string; dish: string; restaurant: string; followed: boolean; testID?: string }) {
  const t = useT();
  const toast = useToast();
  const signedIn = useSignedIn();
  const follow = useFollowDish();
  if (!signedIn) return null;
  const toggle = () =>
    follow.mutate(
      { merchantOrgId, itemId, on: !followed },
      {
        onSuccess: () => toast.show({ message: followed ? t('pots.unfollowed_toast', { dish }) : t('pots.followed_toast'), tone: 'success', icon: 'bell' }),
        onError: () => toast.show({ message: t('pots.follow_failed'), tone: 'danger' }),
      },
    );
  return (
    <IconButton
      testID={testID}
      icon="bell"
      variant={followed ? 'accent' : 'outline'}
      size={44}
      disabled={follow.isPending}
      accessibilityLabel={followed ? t('pots.unfollow_a11y', { dish }) : t('pots.follow_a11y', { restaurant, dish })}
      onPress={toggle}
    />
  );
}
