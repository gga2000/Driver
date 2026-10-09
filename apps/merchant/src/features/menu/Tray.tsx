import { memo, useState } from 'react';
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { temperatureOf } from '@driver/ui/dishes';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { Glyph } from './Glyph';
import { itemStatus } from './logic';
import { absoluteUrl } from './photo';
import { NoPhotoTile } from './parts';
import { tiersOf } from './tiers';

export interface TrayProps {
  item: AdminMenuItem;
  now: number;
  /** Tablet trays are a little roomier (bigger stamp, the full «ماكو صورة» line). */
  wide: boolean;
  onSoldOut: (item: AdminMenuItem) => void;
  onBack: (item: AdminMenuItem) => void;
  onOpen: (item: AdminMenuItem) => void;
  onPhoto: (item: AdminMenuItem) => void;
}

/**
 * One dish in the glass display (counter step 4, m1–m3, p1, p2, k4): its photo or (d21) a clean «ماكو
 * صورة» tile, its name, its price with the weights or sizes it comes in, and its state stamped across it.
 *
 * One tap is the whole job at the counter: a dish that ran out gets «خلص اليوم» (it comes back by itself
 * tomorrow); tap it again and it is back now. A dish switched off for good opens the editor, where hiding
 * lives. The pencil in the corner opens the editor too, and a dish with no photo asks for one.
 */
export const Tray = memo(function Tray({ item, now, wide, onSoldOut, onBack, onOpen, onPhoto }: TrayProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [picH, setPicH] = useState(0);
  const status = itemStatus(item, now);
  const on = status === 'on';
  const tiers = tiersOf(item);
  const price = tiers ? t('merchant.display.from', { price: iqd(tiers.tiers[0]!.priceIqd, { locale }) }) : iqd(item.priceIqd, { locale });
  const unit = tiers ? tiers.tiers.map((x) => x.name).join(' · ') : null;
  const temp = temperatureOf(item.nameAr, item.categoryAr ?? undefined);
  const label =
    status === 'on'
      ? t('merchant.display.a11y_on', { name: item.nameAr, price })
      : status === 'sold_out_today'
        ? t('merchant.display.a11y_sold_out', { name: item.nameAr })
        : t('merchant.display.a11y_off', { name: item.nameAr });
  const press = () => {
    theme.haptic(on ? 'medium' : 'light');
    if (status === 'on') onSoldOut(item);
    else if (status === 'sold_out_today') onBack(item);
    else onOpen(item);
  };

  return (
    <View testID={`dish-${item.id}`} style={{ flex: 1 }}>
      <Pressable
        testID={`tray-tap-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: status === 'sold_out_today' }}
        onPress={press}
        style={({ pressed }) => ({
          flex: 1,
          gap: 6,
          padding: theme.space[2],
          paddingBottom: theme.space[3],
          borderRadius: theme.radius.xl,
          backgroundColor: on ? COUNTER.paper : theme.colors.surfaceSunken,
          borderWidth: 1.5,
          borderColor: status === 'sold_out_today' ? withAlpha(COUNTER.late, 0.45) : on ? 'transparent' : theme.colors.border,
          shadowColor: COUNTER.date,
          shadowOpacity: on ? 0.14 : 0,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
          elevation: on ? 2 : 0,
          transform: [{ scale: pressed && !theme.reduceMotion ? 0.97 : 1 }],
        })}
      >
        <View onLayout={(e) => setPicH(e.nativeEvent.layout.height)} style={{ aspectRatio: 1.3, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: COUNTER.sand }}>
          {item.photoUrl ? <Image source={{ uri: absoluteUrl(item.photoUrl) }} recyclingKey={item.id} transition={120} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityIgnoresInvertColors /> : <NoPhotoTile testID={`tray-nophoto-${item.id}`} />}
          {!on ? <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: withAlpha(COUNTER.sand, 0.62) }} /> : null}
          {status === 'sold_out_today' ? <Stamp wide={wide} title={t('merchant.menu.sold_out_today')} sub={t('merchant.display.stamp_back')} tone="late" /> : null}
          {status === 'off' ? <Stamp wide={wide} title={t('merchant.menu.off')} tone="off" /> : null}
          {/* p4 (Ali 2026-10-08): his new photo is already on the customer menu; our team looks at it the same day. */}
          {item.photoUrl && item.photoReviewPending ? (
            <View
              testID={`tray-review-${item.id}`}
              accessibilityLabel={`${t('merchant.menu.photo_pending')} · ${t('merchant.menu.photo_pending_hint')}`}
              style={{ position: 'absolute', bottom: 8, start: 8, maxWidth: '90%', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 26, paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radius.pill, backgroundColor: withAlpha(COUNTER.paper, 0.95), borderWidth: 1, borderColor: COUNTER.dateEdge }}
            >
              <Glyph name="history" size={13} color={COUNTER.date} strokeWidth={2} />
              <Text weight={700} numberOfLines={1} style={{ flexShrink: 1, color: COUNTER.date, fontSize: 12, lineHeight: 17 }}>
                {t('merchant.menu.photo_pending')}
              </Text>
            </View>
          ) : null}
          {temp && on ? (
            <View style={{ position: 'absolute', top: 8, end: 8, flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 8, borderRadius: theme.radius.pill, backgroundColor: temp === 'cold' ? COUNTER.date : COUNTER.newBadge }}>
              <Glyph name={temp === 'cold' ? 'snow' : 'steam'} size={13} color={COUNTER.onDate} strokeWidth={2} />
              <Text variant="caption" weight={700} style={{ color: COUNTER.onDate, fontSize: 12, lineHeight: 16 }}>
                {temp === 'cold' ? t('merchant.display.cold') : t('merchant.display.hot')}
              </Text>
            </View>
          ) : null}
        </View>
        <Text weight={700} numberOfLines={2} color={on ? 'text' : 'textMuted'} style={[theme.face('display'), { fontSize: wide ? 16 : 15, lineHeight: wide ? 23 : 21, paddingHorizontal: 4 }]}>
          {item.nameAr}
        </Text>
        <View style={{ paddingHorizontal: 4, gap: 2 }}>
          <Text variant="label" weight={700} color={on ? 'text' : 'textMuted'} tabular numberOfLines={1}>
            {price}
          </Text>
          {unit ? (
            <Text variant="caption" color="textMuted" numberOfLines={1}>
              {unit}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {/* Over the tray (siblings, so their taps never reach the tray's own sold-out tap). */}
      <Pressable
        testID={`tray-edit-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={t('merchant.menu.edit_item', { name: item.nameAr })}
        hitSlop={6}
        onPress={() => onOpen(item)}
        style={({ pressed }) => ({ position: 'absolute', top: theme.space[2] + 6, start: theme.space[2] + 6, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(COUNTER.paper, 0.94), borderWidth: 1, borderColor: theme.colors.border, opacity: pressed ? 0.7 : 1 })}
      >
        <Glyph name="pencil" size={17} color="text" strokeWidth={2} />
      </Pressable>
      {!item.photoUrl && on && picH > 0 ? (
        <Pressable
          testID={`tray-photo-${item.id}`}
          accessibilityRole="button"
          accessibilityLabel={t('merchant.display.no_photo')}
          hitSlop={4}
          onPress={() => onPhoto(item)}
          style={({ pressed }) => ({
            position: 'absolute',
            top: theme.space[2] + picH - 36 - 8,
            start: theme.space[2] + 8,
            height: 36,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingHorizontal: 10,
            borderRadius: theme.radius.pill,
            // Paper on the picture, not the busy gold: gold on the counter means busy mode only.
            backgroundColor: withAlpha(COUNTER.paper, 0.95),
            borderWidth: 1,
            borderColor: COUNTER.dateEdge,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Glyph name="camera" size={17} color={COUNTER.date} strokeWidth={2} />
          <Text weight={700} numberOfLines={1} style={{ color: COUNTER.date, fontSize: 13, lineHeight: 19 }}>
            {wide ? t('merchant.display.no_photo') : t('merchant.display.no_photo_short')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

/** «خلص اليوم · يرجع باچر» (or «طافي») stamped across the picture, a little crooked like a real stamp. */
function Stamp({ title, sub, tone, wide }: { title: string; sub?: string; tone: 'late' | 'off'; wide: boolean }) {
  const theme = useTheme();
  const bg = tone === 'late' ? COUNTER.late : COUNTER.dateRaised;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', paddingHorizontal: wide ? 14 : 10, paddingVertical: 4, borderRadius: theme.radius.md, backgroundColor: bg, transform: [{ rotate: '-8deg' }], shadowColor: COUNTER.date, shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 4 }, elevation: 3 }}>
        <Text weight={700} style={[theme.face('display'), { color: COUNTER.onDate, fontSize: wide ? 17 : 15, lineHeight: wide ? 26 : 23 }]}>
          {title}
        </Text>
        {sub ? (
          <Text weight={600} style={{ color: COUNTER.onDate, fontSize: 12, lineHeight: 17 }}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
