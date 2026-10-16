import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CatalogSearchDish } from '@driver/contracts';
import { Button, ModalSheet, Text, useTheme } from '@driver/ui';
import { SectionHeader } from '@/components/SectionHeader';
import { motifForDish, motifForKitchen } from '@/features/food/food-art';
import { RestaurantRow } from '@/features/food/RestaurantRow';
import { distinctPhotos, photoForMotif } from '@/features/food-landing/photos';
import { useT } from '@/lib/i18n';
import { CompareSheet } from './CompareSheet';
import type { ShopPick } from './doors';
import { PickCard } from './PickCard';

/**
 * «أحسن 3 هسة» (ideas k1, r3, k3, k2): three shops, each with the one true reason it is here («طلبت
 * منه قبل», «أعلى تقييم هنا», «الأسرع لبابك»…), a line saying none of it is paid, and «قارن بيناتهم»
 * to see them side by side. The same card as everywhere else (r8): only the reason line is new. Picks
 * for a craving carry their dish (its price on the row and in the compare). «ليش هالترتيب؟» (k3) says
 * in four plain lines how the order is made and that no shop pays for it. `look="photo"` (the food
 * doors, Ali 2026-10-08 concept A) draws each pick as a photo card instead of the list row.
 */
export function BestThree({
  picks,
  title,
  action,
  onOpen,
  testID = 'best-three',
  cold,
  look = 'row',
}: {
  picks: ReadonlyArray<ShopPick & { dish?: CatalogSearchDish }>;
  title?: string;
  action?: { label: string; onPress: () => void };
  onOpen?: () => void;
  testID?: string;
  cold?: boolean;
  look?: 'row' | 'photo';
}) {
  const theme = useTheme();
  const t = useT();
  const [comparing, setComparing] = useState(false);
  const [why, setWhy] = useState(false);
  if (picks.length === 0) return null;
  const photos = look === 'photo' ? distinctPhotos(picks.map((p) => (p.dish ? motifForDish(p.dish.name) : motifForKitchen(p.shop.tags, p.shop.cuisine)))) : [];
  return (
    <View style={{ gap: theme.space[3] }} testID={testID}>
      <View style={{ gap: 2 }}>
        {/* The heading gets the full width (a craving name plus «كل المحلات» squeezed it onto two lines at 360 px). */}
        <SectionHeader big title={title ?? t('food.best')} />
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
          {action ? (
            <Pressable
              testID={`${testID}-clear`}
              accessibilityRole="button"
              onPress={action.onPress}
              hitSlop={12}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 28 }}
            >
              <Text variant="footnote" weight={700} color="accentText">
                {action.label}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {picks.map((p, i) =>
        look === 'photo' ? (
          <PickCard
            key={p.shop.id}
            r={p.shop}
            reason={t(`food.reason.${p.reason}`, { rating: p.shop.rating?.toFixed(1) ?? '' })}
            photo={photos[i] ?? photoForMotif('plate')}
            testID={`${testID}-${p.shop.id}`}
            {...(p.dish ? { dish: p.dish } : {})}
            {...(cold ? { cold } : {})}
            {...(onOpen ? { onOpen } : {})}
          />
        ) : (
          <RestaurantRow
          key={p.shop.id}
          r={p.shop}
          reason={t(`food.reason.${p.reason}`, { rating: p.shop.rating?.toFixed(1) ?? '' })}
          testID={`${testID}-${p.shop.id}`}
          {...(p.dish ? { dish: p.dish } : {})}
          {...(cold ? { cold } : {})}
          {...(onOpen ? { onOpen } : {})}
          />
        ),
      )}
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
