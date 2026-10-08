import { router } from 'expo-router';
import { Fragment, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { longRideForHotFood } from '@driver/contracts';
import { formatRange } from '@driver/i18n';
import { Icon, PhotoImage, Skeleton, stageOf, Text, useTheme } from '@driver/ui';
import { DealSticker } from '@/features/food/DealBadge';
import { FoodArt, kitchenLook, motifForKitchen, type Motif } from '@/features/food/FoodArt';
import { LongRide } from '@/features/food/RestaurantRow';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { apiPhoto } from '@/lib/photo';
import { kitchenPhotos } from './dish-photos';
import { HOME_KITCHENS, sharedFee } from './kitchens';
import type { RestaurantSummary } from './restaurant-summary';

/** A kitchen's picture in its row. */
const PIC = 56;

/**
 * «مفتوح هسة» on home (concept C, Ali 2026-10-08): the first few open kitchens as plain rows on the
 * page, flat like the cards above (no boxes, no shadow): a photo (its own, else one of its kind, else
 * its warm drawing), the name, its rating («جديد» before real ratings) and minutes. The delivery fee is
 * said once over the list when every kitchen charges the same; a row says its own only when they
 * differ. «كل المحلات» opens the rest.
 */
export function KitchenRows({
  title,
  kitchens,
  count,
  showing = [],
  testID = 'rail-open',
}: {
  title: string;
  kitchens: readonly RestaurantSummary[];
  count: string;
  /** The stand-in photos' kinds already on the page (the hour's dishes): rows pick others. */
  showing?: readonly Motif[];
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const shown = kitchens.slice(0, HOME_KITCHENS);
  const fee = sharedFee(kitchens);
  // A kitchen without its own photo shows one for its kind (two in a row never share one), else its drawing.
  const motifs = useMemo(() => kitchens.slice(0, HOME_KITCHENS).map((r) => motifForKitchen(r.tags, r.cuisine)), [kitchens]);
  const photos = useMemo(() => kitchenPhotos(motifs, showing), [motifs, showing]);
  const openAll = () => {
    theme.haptic('selection');
    router.push({ pathname: '/restaurants', params: { preset: 'open' } });
  };
  return (
    <View testID={testID} style={{ gap: theme.space[2] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space[3], minHeight: 36 }}>
        <Text variant="section" face="display" accessibilityRole="header">
          {title}
        </Text>
        {fee !== null ? (
          <Text testID={`${testID}-fee`} variant="footnote" color="textMuted" tabular>
            {fee <= 0 ? t('home.fee_all_free') : t('home.fee_all', { amount: amountParam(fee) })}
          </Text>
        ) : null}
      </View>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
        {shown.map((r, i) => (
          <KitchenRow key={r.id} r={r} motif={motifs[i]!} photo={photos[i] ?? null} ownFee={fee === null} testID={`restaurant-${r.id}`} />
        ))}
        {kitchens.length > HOME_KITCHENS ? (
          <Pressable
            testID={`${testID}-all`}
            accessibilityRole="button"
            accessibilityLabel={t('home.all_kitchens_a11y', { count })}
            onPress={openAll}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              minHeight: theme.hitTarget + 8,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: theme.colors.border,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text variant="bodyStrong" weight={700} style={{ flex: 1 }}>
              {t('home.all_kitchens')}
              <Text variant="footnote" weight={400} color="textMuted">
                {`  ·  ${count}`}
              </Text>
            </Text>
            <Icon name="chevron-forward" size={18} color="textMuted" />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function KitchenRow({ r, motif, photo, ownFee, testID }: { r: RestaurantSummary; motif: Motif; photo: number | null; ownFee: boolean; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [failed, setFailed] = useState(false);
  const uri = failed ? null : apiPhoto(r.photoUrl);
  const minutes = t('list.minutes', {
    range: r.etaMinMinutes !== null && r.etaMaxMinutes !== null ? formatRange(r.etaMinMinutes, r.etaMaxMinutes, locale) : formatRange(r.prepMinMinutes, r.prepMaxMinutes, locale),
  });
  const free = r.deliveryFeeIqd !== null && r.deliveryFeeIqd <= 0;
  const fee = ownFee && r.deliveryFeeIqd !== null ? (free ? t('list.fee_free') : t('list.fee', { amount: amountParam(r.deliveryFeeIqd) })) : null;
  const rating = r.rating === null ? t('list.new') : r.rating.toFixed(1);
  // The facts after the rating, «·» between them.
  const facts = [minutes, fee].filter((f): f is string => f !== null);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[r.name, r.rating === null ? rating : t('home.kitchen_stars_a11y', { n: rating }), ...facts].join('، ')}
      onPress={() => {
        theme.haptic('selection');
        router.push({ pathname: '/restaurant/[id]', params: { id: r.id } });
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        paddingVertical: theme.space[3],
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ width: PIC, height: PIC, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
        {uri ? (
          <PhotoImage uri={uri} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} />
        ) : photo !== null ? (
          <Image source={photo} resizeMode="cover" accessible={false} style={{ width: '100%', height: '100%' }} />
        ) : (
          <FoodArt motif={motif} look={kitchenLook(r.id)} stage={stageOf(r.id, theme.decor.stages)} photoUrl={null} />
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Text variant="bodyStrong" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
            {r.name}
          </Text>
          {r.dealCount > 0 ? <DealSticker label={t('list.deal')} /> : null}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[2], rowGap: 2 }}>
          {r.rating === null ? (
            <View testID={`${testID}-new`} style={{ paddingHorizontal: theme.space[2], paddingVertical: 1, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accentTint }}>
              <Text variant="caption" weight={700} color="accentText" compact>
                {rating}
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <Icon name="star" size={13} color="starOutline" fillColor="star" filled strokeWidth={1.6} />
              <Text variant="footnote" weight={600} tabular>
                {rating}
              </Text>
            </View>
          )}
          {facts.map((f) => (
            <Fragment key={f}>
              <Text variant="footnote" color="textMuted" aria-hidden>
                ·
              </Text>
              <Text variant="footnote" weight={f === fee && free ? 700 : 400} color={f === fee && free ? 'accentText' : 'textMuted'} tabular numberOfLines={1}>
                {f}
              </Text>
            </Fragment>
          ))}
        </View>
        {longRideForHotFood(r) ? <LongRide testID={`${testID}-long-ride`} /> : null}
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}

/** The list while kitchens load: the same rows, drawn quiet. */
export function KitchenRowsSkeleton() {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessibilityLabel={t('status.loading')} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border }}>
          <Skeleton width={PIC} height={PIC} radius={theme.radius.lg} />
          <View style={{ flex: 1, gap: theme.space[2] }}>
            <Skeleton height={14} width="50%" />
            <Skeleton height={12} width="35%" />
          </View>
        </View>
      ))}
    </View>
  );
}
