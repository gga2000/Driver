import { View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/**
 * «مميّز» (Ali, 2026-10-12, the date stamp): a kitchen on the featured tier says so beside its name, a
 * date-dark stamp with gold letters, so it never looks like the saffron deal sticker. Shown only while
 * the kitchen is open.
 */
export function FeaturedStamp({ testID }: { testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: theme.space[2], minHeight: 22, borderRadius: theme.radius.sm, backgroundColor: theme.colors.inverse }}
    >
      <Icon name="award" size={13} color={theme.colors.onInverseAccent} strokeWidth={2.2} />
      <Text variant="caption" weight={700} numberOfLines={1} compact style={{ color: theme.colors.onInverseAccent }}>
        {t('list.featured')}
      </Text>
    </View>
  );
}
