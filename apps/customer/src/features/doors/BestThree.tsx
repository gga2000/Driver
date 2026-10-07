import { useState } from 'react';
import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { RestaurantRow } from '@/features/food/RestaurantRow';
import { useT } from '@/lib/i18n';
import { CompareSheet } from './CompareSheet';
import type { ShopPick } from './doors';

/**
 * «أحسن 3 هسة» (ideas k1, r3, k3, k2): three shops, each with the one true reason it is here («طلبت
 * منه قبل», «أعلى تقييم هنا», «الأسرع لبابك»…), a line saying none of it is paid, and «قارن بيناتهم»
 * to see them side by side. The same card as everywhere else (r8): only the reason line is new.
 */
export function BestThree({
  picks,
  title,
  action,
  onOpen,
  testID = 'best-three',
}: {
  picks: readonly ShopPick[];
  title?: string;
  action?: { label: string; onPress: () => void };
  onOpen?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const [comparing, setComparing] = useState(false);
  if (picks.length === 0) return null;
  return (
    <View style={{ gap: theme.space[3] }} testID={testID}>
      <View style={{ gap: 2 }}>
        <SectionHeader big title={title ?? t('food.best')} {...(action ? { action } : {})} />
        <Text variant="footnote" color="textMuted">
          {t('food.best_hint')}
        </Text>
      </View>
      {picks.map((p) => (
        <RestaurantRow
          key={p.shop.id}
          r={p.shop}
          reason={t(`food.reason.${p.reason}`, { rating: p.shop.rating?.toFixed(1) ?? '' })}
          testID={`${testID}-${p.shop.id}`}
          {...(onOpen ? { onOpen } : {})}
        />
      ))}
      {picks.length >= 2 ? (
        <Button
          testID={`${testID}-compare`}
          variant="secondary"
          icon="filter"
          label={t('food.compare')}
          onPress={() => setComparing(true)}
          style={{ alignSelf: 'center' }}
        />
      ) : null}
      <CompareSheet picks={picks} visible={comparing} onClose={() => setComparing(false)} />
    </View>
  );
}
