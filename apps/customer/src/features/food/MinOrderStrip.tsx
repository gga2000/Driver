import { View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import type { MinOrderProgress } from './min-order';

/**
 * f11 (UI/UX audit F-04): right above the cart's button, how far the basket is toward the
 * restaurant's minimum («باقي 1,750 دينار وتوصل لأقل طلب») with a progress bar, and — since J-D6 the
 * minimum is a choice — that it can go now with the small-order fee («أو اطلب هسة برسوم 500 دينار»).
 * The fee is the server's (`orders.quote` / the restaurant card); this only shows it.
 */
export function MinOrderStrip({ progress, minOrderIqd, feeIqd }: { progress: MinOrderProgress; minOrderIqd: number; feeIqd: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="cart-min-strip" style={{ gap: theme.space[1] }} accessibilityLiveRegion="polite">
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={t('cart.min_progress_a11y', { done: amountParam(progress.doneIqd), min: amountParam(minOrderIqd) })}
        accessibilityValue={{ min: 0, max: minOrderIqd, now: progress.doneIqd }}
        style={{ height: 6, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}
      >
        <View style={{ width: `${Math.round(progress.ratio * 100)}%`, height: '100%', borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent }} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="bag" size={16} color="accentText" />
        <Text variant="footnote" weight={600} style={{ flex: 1 }} tabular>
          {t('cart.min_progress', { amount: amountParam(progress.shortIqd) })}
        </Text>
      </View>
      {feeIqd > 0 ? (
        <Text variant="caption" color="textMuted" testID="cart-min-fee" tabular>
          {t('cart.min_or_fee', { fee: amountParam(feeIqd) })}
        </Text>
      ) : null}
    </View>
  );
}
