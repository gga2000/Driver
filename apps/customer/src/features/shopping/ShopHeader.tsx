import { router, type Href } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconButton, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * The top of a shopping screen without a photo: the back button (→ in Arabic) and the title with one
 * quiet line under it. Opened from a link with no history, back goes to `fallback`.
 */
export function ShopHeader({ title, sub, fallback = '/shopping' }: { title: string; sub?: string; fallback?: Href }) {
  const theme = useTheme();
  const t = useT();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingTop: insets.top + theme.space[3] }}>
      <IconButton
        icon="arrow-back"
        variant="tonal"
        accessibilityLabel={t('action.back')}
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      />
      <View style={{ flex: 1 }}>
        <Text variant="heading" accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text variant="footnote" color="textMuted" numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
