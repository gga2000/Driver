import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatAmount, formatIqd, Icon, QueryBoundary, Skeleton, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { useT } from '@/lib/i18n';
import { basket, basketIqd, useBasket } from '@/features/shopping/basket';
import { GreenBar } from '@/features/shopping/GreenBar';
import type { ProduceItem, Stall } from '@/features/shopping/model';
import { useShopping } from '@/features/shopping/palette';
import { priceMove } from '@/features/shopping/prices';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useStall } from '@/features/shopping/queries';
import { ShopHeader } from '@/features/shopping/ShopHeader';
import { useWeightText, WeightSheet } from '@/features/shopping/WeightSheet';

/**
 * A stall's today (round 2 «البسطية: صور اليوم»): when it photographed and priced this morning, then
 * every item as today's photo with its price and how it moved since yesterday. Tapping one opens the
 * scale. A `?item=` link (from the front's price strip) opens that item's scale straight away.
 */
export default function StallScreen() {
  const { id, item } = useLocalSearchParams<{ id: string; item?: string }>();
  const theme = useTheme();
  const t = useT();
  const stall = useStall(id);
  return (
    <QueryBoundary
      style={{ flex: 1 }}
      query={stall}
      skeleton={
        <Screen>
          <Skeleton style={{ height: 520, borderRadius: theme.radius.xl }} />
        </Screen>
      }
      isEmpty={(s) => s == null}
      empty={{ icon: 'bag', title: t('shopping.stall_gone'), action: { label: t('shopping.door_produce'), onPress: () => router.replace('/shopping/produce') } }}
    >
      {(s) => (s ? <StallBody stall={s} openItem={item} /> : null)}
    </QueryBoundary>
  );
}

function StallBody({ stall, openItem }: { stall: Stall; openItem?: string }) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const toast = useToast();
  const cart = useBasket();
  const [open, setOpen] = useState<ProduceItem | null>(null);
  useEffect(() => {
    if (openItem) setOpen(stall.items.find((i) => i.id === openItem) ?? null);
  }, [openItem, stall.items]);

  const lines = useMemo(() => (cart.stallId === stall.id ? cart.lines : []), [cart.stallId, cart.lines, stall.id]);
  const total = useMemo(() => basketIqd(lines, stall.items), [lines, stall.items]);
  const current = open ? lines.find((l) => l.itemId === open.id) : undefined;
  const owner = stall.name;

  return (
    <>
      <Screen
        testID="shopping-stall"
        edges={['bottom']}
        footer={
          lines.length ? (
            <GreenBar
              label={t('shopping.basket_count', { n: lines.length })}
              amountIqd={total}
              onPress={() => toast.show({ message: t('shopping.checkout_soon') })}
            />
          ) : undefined
        }
      >
        <ShopHeader
          title={stall.name}
          sub={t('shopping.stall_meta', { rating: stall.rating, area: stall.area, min: stall.minutes })}
          fallback="/shopping/produce"
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: shop.tint, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
          <Icon name="camera" size={22} color={shop.fill} />
          <Text variant="label" weight={600} style={{ flex: 1, color: shop.onTint }}>
            {stall.postedAt ? t('shopping.posted_banner', { time: stall.postedAt }) : t('shopping.not_posted_banner')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: theme.space[3] }}>
          {stall.items.map((item) => (
            <ItemCard key={item.id} item={item} amount={lines.find((l) => l.itemId === item.id)?.amount ?? 0} onPress={() => setOpen(item)} />
          ))}
        </View>
      </Screen>
      {open ? (
        <WeightSheet
          item={open}
          current={current?.amount ?? 0}
          currentNote={current?.note ?? ''}
          stallOwner={owner}
          onClose={() => setOpen(null)}
          onSave={(amount, note) => {
            if (cart.stallId && cart.stallId !== stall.id && cart.lines.length) {
              toast.show({ message: t('shopping.basket_switched') });
            }
            basket.set(stall.id, open.id, amount, note);
            theme.haptic('light');
            setOpen(null);
          }}
        />
      ) : null}
    </>
  );
}

function ItemCard({ item, amount, onPress }: { item: ProduceItem; amount: number; onPress: () => void }) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const weightText = useWeightText();
  const move = priceMove(item);
  const unit = item.soldBy === 'kg' ? t('shopping.price_unit_kg') : t('shopping.price_unit_piece');
  const moveText =
    move.kind === 'down'
      ? t('shopping.move_down', { amount: formatAmount(move.byIqd) })
      : move.kind === 'up'
        ? t('shopping.move_up', { amount: formatAmount(move.byIqd) })
        : move.kind === 'same'
          ? t('shopping.move_same')
          : move.kind === 'new'
            ? t('shopping.move_new')
            : t('shopping.move_yesterday');
  const moveColor = move.kind === 'down' ? shop.down : move.kind === 'up' ? shop.up : theme.colors.textMuted;
  const inBasket = amount > 0 ? (item.soldBy === 'kg' ? weightText(amount) : t('shopping.pieces', { n: amount })) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[item.name, `${formatIqd(item.priceIqd)} ${unit}`, moveText, item.photoToday ? null : t('shopping.photo_yesterday'), inBasket ? t('shopping.in_basket', { what: inBasket }) : null]
        .filter(Boolean)
        .join('، ')}
      onPress={onPress}
      style={({ pressed }) => ({
        width: '48%',
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        borderWidth: amount > 0 ? 2 : 1,
        borderColor: amount > 0 ? shop.fill : theme.colors.border,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <View>
        <ProducePhoto uri={item.photo} label="" style={{ width: '100%', height: 118 }} />
        {inBasket ? (
          <View style={{ position: 'absolute', top: theme.space[2], start: theme.space[2], flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: shop.fill, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[2], paddingVertical: 2 }}>
            <Icon name="check" size={12} color={shop.on} />
            <Text variant="caption" weight={700} style={{ color: shop.on }}>
              {inBasket}
            </Text>
          </View>
        ) : null}
        {!item.photoToday ? (
          <View style={{ position: 'absolute', bottom: theme.space[2], end: theme.space[2], backgroundColor: theme.colors.photoBackdrop, borderRadius: theme.radius.pill, paddingHorizontal: theme.space[2] }}>
            <Text variant="caption" weight={600} style={{ color: theme.colors.onPhotoBackdrop }}>
              {t('shopping.photo_yesterday')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], gap: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: theme.space[2] }}>
          <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
            {item.name}
          </Text>
          <Text variant="bodyStrong" weight={700} tabular>
            {formatAmount(item.priceIqd)}
          </Text>
        </View>
        <Text variant="caption" color="textMuted" numberOfLines={1}>
          {unit}
        </Text>
        <Text variant="caption" weight={600} numberOfLines={1} style={{ color: moveColor }}>
          {moveText}
        </Text>
      </View>
    </Pressable>
  );
}
