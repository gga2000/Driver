import { View } from 'react-native';
import { Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import type { Bakery } from './model';
import { useShopping } from './palette';

/** A bakery's state in words (Ali 2026-10-11: a bakery is open, paused for a bit, or closed). */
export function useBakeryStateText(): (b: Pick<Bakery, 'state' | 'resumesAt' | 'opensAt'>) => string {
  const t = useT();
  return (b) =>
    b.state === 'open'
      ? t('shopping.bakery_open')
      : b.state === 'paused'
        ? b.resumesAt
          ? t('shopping.bakery_paused_until', { time: b.resumesAt })
          : t('shopping.bakery_paused')
        : b.opensAt
          ? t('shopping.bakery_closed_until', { time: b.opensAt })
          : t('shopping.bakery_closed');
}

/** The state as a pill with its dot: green open, saffron paused, quiet closed. */
export function BakeryStatePill({ bakery, onPhoto }: { bakery: Pick<Bakery, 'state' | 'resumesAt' | 'opensAt'>; onPhoto?: boolean }) {
  const theme = useTheme();
  const shop = useShopping();
  const text = useBakeryStateText()(bakery);
  const tone =
    bakery.state === 'open'
      ? { bg: shop.tint, fg: shop.onTint, dot: shop.fill }
      : bakery.state === 'paused'
        ? { bg: theme.colors.warningTint, fg: theme.colors.warningText, dot: theme.colors.warning }
        : { bg: onPhoto ? theme.colors.surface : theme.colors.surfaceSunken, fg: theme.colors.textMuted, dot: theme.colors.borderStrong };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, minHeight: 28, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, backgroundColor: tone.bg }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tone.dot }} />
      <Text variant="footnote" weight={700} style={{ color: tone.fg }}>
        {text}
      </Text>
    </View>
  );
}
