import { View, type ViewStyle } from 'react-native';
import { Icon, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import type { LiveKind, LivePin } from './logic';

/** Each kind's colour and mark: food saffron, tea and coffee date brown, bakeries wheat gold. */
export function useKindLook(): Record<LiveKind, { fill: string; on: string; icon: IconName }> {
  const s = useTheme().services;
  return {
    food: { fill: s.food.fill, on: s.food.on, icon: 'food' },
    coffee: { fill: s.trips.fill, on: s.trips.on, icon: 'moon' },
    bakery: { fill: s.back.fill, on: s.back.on, icon: 'flame' },
  };
}

const DISC = 30;

/** «يطبخ هسة» as a mark: a small cinnamon dot in a paper ring (a flame at this size reads like a digit). */
export function CookingDot({ style }: { style?: ViewStyle }) {
  const theme = useTheme();
  return <View style={[{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.surface, backgroundColor: theme.colors.live }, style]} />;
}
const SHADOW = '0 2px 6px rgba(40,24,8,0.28)';

/**
 * A shop that shows its name: the kind's disc, the short name and the minutes to the door ("17 د").
 * A cooking shop gets a small flame on its disc («يطبخ هسة»). `dim` while an order is on the map.
 */
export function LiveBubble({ pin, dim }: { pin: LivePin; dim?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const look = useKindLook()[pin.kind];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 3, paddingEnd: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: withAlpha(theme.colors.surface, 0.96), boxShadow: SHADOW, opacity: dim ? 0.45 : 1, maxWidth: 190 }}>
      <View style={{ width: DISC, height: DISC, borderRadius: DISC / 2, backgroundColor: look.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={look.icon} size={15} color={look.on} strokeWidth={2.2} />
        {pin.cooking ? <CookingDot style={{ position: 'absolute', top: -2, end: -2 }} /> : null}
      </View>
      <Text variant="caption" weight={700} numberOfLines={1} style={{ flexShrink: 1 }}>
        {pin.card.name}
      </Text>
      {pin.minutes !== null ? (
        <Text variant="caption" weight={700} tabular color="accentText">
          {t('live_map.min', { n: pin.minutes })}
        </Text>
      ) : null}
    </View>
  );
}

/** A quiet shop: a small dot in its kind's colour (grey when closed). */
export function LiveDot({ pin, dim }: { pin: LivePin; dim?: boolean }) {
  const theme = useTheme();
  const look = useKindLook()[pin.kind];
  return (
    <View
      style={{
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: theme.colors.surface,
        backgroundColor: pin.card.open ? look.fill : theme.colors.borderStrong,
        boxShadow: SHADOW,
        opacity: dim ? 0.4 : pin.card.open ? 1 : 0.8,
      }}
    />
  );
}

/** Their place: a date-brown disc with the house, and «بيتك» (or «مكانك») under it. */
export function HomePin({ label }: { label: string }) {
  const theme = useTheme();
  const s = theme.services.trips;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: theme.colors.surface, backgroundColor: s.fill, alignItems: 'center', justifyContent: 'center', boxShadow: SHADOW }}>
        <Icon name="home" size={16} color={s.on} strokeWidth={2.3} />
      </View>
      <View style={{ marginTop: 3, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: s.fill }}>
        <Text variant="caption" weight={700} style={{ color: s.on }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Their own courier on the way: a saffron disc with the bike, in a white ring. */
export function CourierDisc() {
  const theme = useTheme();
  return (
    <View style={{ width: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: theme.colors.surface, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(40,24,8,0.35)' }}>
      <Icon name="bike" size={18} color="onAccent" strokeWidth={2.3} />
    </View>
  );
}

/** The kitchen making their order: its name and «يجهّز طلبك» while it cooks. */
export function OrderKitchen({ name, cooking }: { name: string; cooking: boolean }) {
  const theme = useTheme();
  const t = useT();
  const look = useKindLook().food;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingStart: 3, paddingEnd: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: theme.colors.surface, borderWidth: 2, borderColor: look.fill, boxShadow: SHADOW, maxWidth: 210 }}>
      <View style={{ width: DISC, height: DISC, borderRadius: DISC / 2, backgroundColor: look.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={cooking ? 'flame' : 'food'} size={15} color={look.on} strokeWidth={2.2} />
      </View>
      <View style={{ flexShrink: 1 }}>
        <Text variant="caption" weight={700} numberOfLines={1}>
          {name}
        </Text>
        {cooking ? (
          <Text variant="caption" color="accentText" weight={600} numberOfLines={1}>
            {t('live_map.order_kitchen')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
