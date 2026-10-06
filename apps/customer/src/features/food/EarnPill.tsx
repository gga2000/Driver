import { View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { earnCopy } from './checkout-lines';

/**
 * «تكسب 27 نقطة» (joy o7): the server's points estimate for this order as a small saffron sticker
 * (points are a treat, J-D1), next to the button that earns them. Nothing when it earns none.
 */
export function EarnPill({ points, grouped }: { points: number | null | undefined; grouped: boolean }) {
  const theme = useTheme();
  const t = useT();
  const copy = earnCopy(points, grouped);
  if (!copy) return null;
  return (
    <View
      testID="earn-pill"
      style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: theme.space[3], paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.deal }}
    >
      <Icon name="gift" size={14} color="onDeal" />
      <Text variant="caption" weight={600} color="onDeal" tabular>
        {t(copy.key, copy.params)}
      </Text>
    </View>
  );
}
