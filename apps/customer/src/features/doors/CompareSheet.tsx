import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import type { CatalogSearchDish } from '@driver/contracts';
import { Button, Icon, ModalSheet, stageOf, Text, useTheme } from '@driver/ui';
import { DishDrawing } from '@driver/ui/dishes';
import { kitchenLook, motifForKitchen } from '@/features/food/food-art';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { bestCells, compareRows, type ShopPick } from './doors';

const ART = 56;

/**
 * «قارن بيناتهم» (idea k2): the three shops side by side, four plain rows — rating, door time, delivery
 * and the minimum order — with the single best of each row in the accent and «الأحسن» under it (a tie
 * marks nothing). One «افتح» per shop. No scores and no ads: just the numbers people already compare in
 * their heads, in one place.
 */
export function CompareSheet({
  picks,
  visible,
  onClose,
}: {
  picks: ReadonlyArray<ShopPick & { dish?: CatalogSearchDish }>;
  visible: boolean;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = useT();
  const rows = compareRows(picks);
  const best = bestCells(rows);
  const cols = picks.map((p) => p.shop);
  const cell = (id: string, winner: string | null, value: ReactNode, testID: string) => {
    const won = winner === id;
    return (
      <View
        key={id}
        testID={testID}
        style={{
          flex: 1,
          minWidth: 0,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 52,
          borderRadius: theme.radius.md,
          backgroundColor: won ? theme.colors.accentTint : 'transparent',
          paddingHorizontal: 2,
        }}
      >
        <Text
          variant="bodyStrong"
          weight={700}
          tabular
          align="center"
          numberOfLines={2}
          color={won ? 'accentText' : 'text'}
        >
          {value}
        </Text>
        {won ? (
          <Text variant="caption" weight={600} color="accentText" align="center">
            {t('food.compare_best')}
          </Text>
        ) : null}
      </View>
    );
  };
  const row = (
    label: string,
    winner: string | null,
    render: (i: number) => ReactNode,
    key: string,
  ) => (
    <View key={key} style={{ gap: theme.space[1] }}>
      <Text variant="footnote" color="textMuted">
        {label}
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        {rows.map((r, i) => cell(r.id, winner, render(i), `compare-${key}-${r.id}`))}
      </View>
    </View>
  );
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={picks.length === 2 ? t('food.compare_title_two') : t('food.compare_title')}
      testID="compare-sheet"
    >
      <View style={{ gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {cols.map((r) => (
            <View
              key={r.id}
              style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: theme.space[1] }}
            >
              <View
                style={{
                  width: ART,
                  height: ART,
                  borderRadius: ART / 2,
                  overflow: 'hidden',
                  backgroundColor: stageOf(r.id, theme.decor.stages),
                }}
              >
                <Svg width={ART} height={ART} viewBox="0 0 200 200">
                  <G transform="translate(8 6) scale(0.92)">
                    <DishDrawing
                      kind={motifForKitchen(r.tags, r.cuisine)}
                      look={kitchenLook(r.id)}
                      window={false}
                      line={5}
                    />
                  </G>
                </Svg>
              </View>
              <Text variant="label" weight={700} align="center" numberOfLines={2}>
                {r.name}
              </Text>
            </View>
          ))}
        </View>
        {rows.every((r) => r.dish !== null) && rows[0]?.dish
          ? row(
              rows[0].alike
                ? picks.every((p) => p.dish?.kiloIqd)
                  ? t('food.compare_kilo')
                  : t('food.compare_price', { name: rows[0].dish.name })
                : t('food.compare_dish'),
              best.price,
              (i) => {
                const r = rows[i]!;
                if (r.alike || !r.dish) return t('unit.iqd', { amount: amountParam(r.priceIqd ?? 0) });
                const d = r.dish;
                return d.kiloIqd
                  ? t('food.dish_kilo', { dish: d.name, amount: amountParam(d.kiloIqd) })
                  : t('food.dish_price', { dish: d.name, amount: amountParam(d.priceIqd) });
              },
              'price',
            )
          : null}
        {row(
          t('food.compare_rating'),
          best.rating,
          (i) => {
            const r = rows[i]!;
            return r.rating === null ? t('list.new') : r.rating.toFixed(1);
          },
          'rating',
        )}
        {row(
          t('food.compare_time'),
          best.minutes,
          (i) => t('food.minutes', { n: rows[i]!.minutes }),
          'time',
        )}
        {row(
          t('food.compare_fee'),
          best.fee,
          (i) => {
            const fee = rows[i]!.feeIqd;
            return fee === null
              ? '—'
              : fee <= 0
                ? t('list.fee_free')
                : t('unit.iqd', { amount: amountParam(fee) });
          },
          'fee',
        )}
        {rows.some((r) => r.feeIqd === null) ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[1],
              marginTop: -theme.space[2],
            }}
          >
            <Icon name="map-pin" size={14} color="textMuted" />
            <Text variant="caption" color="textMuted">
              {t('food.compare_unknown')}
            </Text>
          </View>
        ) : null}
        {row(
          t('food.compare_min'),
          best.minOrder,
          (i) => t('unit.iqd', { amount: amountParam(rows[i]!.minOrderIqd) }),
          'min',
        )}
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {cols.map((r) => (
            <Button
              key={r.id}
              testID={`compare-open-${r.id}`}
              size="sm"
              variant="secondary"
              label={t('food.compare_open')}
              accessibilityLabel={`${t('food.compare_open')} ${r.name}`}
              onPress={() => {
                onClose();
                const dish = picks.find((p) => p.shop.id === r.id)?.dish;
                router.push({ pathname: '/restaurant/[id]', params: dish ? { id: r.id, item: dish.id } : { id: r.id } });
              }}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>
    </ModalSheet>
  );
}
