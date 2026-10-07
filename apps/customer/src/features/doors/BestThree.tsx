import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CatalogSearchDish } from '@driver/contracts';
import { Button, ModalSheet, Text, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { RestaurantRow } from '@/features/food/RestaurantRow';
import { useT } from '@/lib/i18n';
import { CompareSheet } from './CompareSheet';
import type { ShopPick } from './doors';

/**
 * «أحسن 3 هسة» (ideas k1, r3, k3, k2): three shops, each with the one true reason it is here («طلبت
 * منه قبل», «أعلى تقييم هنا», «الأسرع لبابك»…), a line saying none of it is paid, and «قارن بيناتهم»
 * to see them side by side. The same card as everywhere else (r8): only the reason line is new. Picks
 * for a craving carry their dish (its price on the row and in the compare). «ليش هالترتيب؟» (k3) says
 * in four plain lines how the order is made and that no shop pays for it.
 */
export function BestThree({
  picks,
  title,
  action,
  onOpen,
  testID = 'best-three',
  cold,
}: {
  picks: ReadonlyArray<ShopPick & { dish?: CatalogSearchDish }>;
  title?: string;
  action?: { label: string; onPress: () => void };
  onOpen?: () => void;
  testID?: string;
  cold?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const [comparing, setComparing] = useState(false);
  const [why, setWhy] = useState(false);
  if (picks.length === 0) return null;
  return (
    <View style={{ gap: theme.space[3] }} testID={testID}>
      <View style={{ gap: 2 }}>
        <SectionHeader big title={title ?? t('food.best')} {...(action ? { action } : {})} />
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: theme.space[2] }}>
          <Text variant="footnote" color="textMuted">
            {t('food.best_hint')}
          </Text>
          <Pressable
            testID={`${testID}-why`}
            accessibilityRole="button"
            onPress={() => setWhy(true)}
            hitSlop={12}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 }}
          >
            <Text variant="footnote" weight={700} color="accentText">
              {t('food.why')}
            </Text>
          </Pressable>
        </View>
      </View>
      {picks.map((p) => (
        <RestaurantRow
          key={p.shop.id}
          r={p.shop}
          reason={t(`food.reason.${p.reason}`, { rating: p.shop.rating?.toFixed(1) ?? '' })}
          testID={`${testID}-${p.shop.id}`}
          {...(p.dish ? { dish: p.dish } : {})}
          {...(cold ? { cold } : {})}
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
      <ModalSheet visible={why} onClose={() => setWhy(false)} title={t('food.why_title')} closeLabel={t('action.close')} testID={`${testID}-why-sheet`}>
        <View style={{ gap: theme.space[3] }}>
          {(['food.why_1', 'food.why_2', 'food.why_3', 'food.why_4'] as const).map((k, i) => (
            <View key={k} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: i === 3 ? theme.colors.accent : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="caption" weight={700} tabular color={i === 3 ? 'onAccent' : 'text'}>
                  {i + 1}
                </Text>
              </View>
              <Text variant="body" weight={i === 3 ? 700 : 400} style={{ flex: 1, lineHeight: 24 }}>
                {t(k)}
              </Text>
            </View>
          ))}
        </View>
      </ModalSheet>
    </View>
  );
}
