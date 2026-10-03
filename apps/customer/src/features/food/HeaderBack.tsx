import { router } from 'expo-router';
import { IconButton } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * Header back button that points the reading direction's way (→ in Arabic): the navigator's default
 * arrow doesn't mirror on web. Used by the food flow's stacked screens (cart, checkout).
 */
export function HeaderBack() {
  const t = useT();
  return (
    <IconButton
      icon="arrow-back"
      variant="plain"
      accessibilityLabel={t('action.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      testID="header-back"
    />
  );
}
