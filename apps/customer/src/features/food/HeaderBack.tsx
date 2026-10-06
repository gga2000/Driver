import { router, type Href } from 'expo-router';
import { IconButton } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * Header back button that points the reading direction's way (→ in Arabic): the navigator's default
 * arrow doesn't mirror on web. Used by the food flow's stacked screens (cart, checkout). A screen
 * opened from a push has nothing to go back to: `fallback` is where the button goes then.
 */
export function HeaderBack({ fallback = '/' }: { fallback?: Href } = {}) {
  const t = useT();
  return (
    <IconButton
      icon="arrow-back"
      variant="plain"
      accessibilityLabel={t('action.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      testID="header-back"
    />
  );
}
