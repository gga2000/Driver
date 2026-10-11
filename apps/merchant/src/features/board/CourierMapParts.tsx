import { View } from 'react-native';
import { Avatar, Icon, Text, useTheme, withAlpha } from '@driver/ui';
import { absoluteUrl } from '@/features/menu/photo';
import { useT } from '@/lib/i18n';
import type { ComingCourier } from './courier-map';

/** A small lift off the map (the theme's elevation 2, without its CSS string). */
function lift(theme: ReturnType<typeof useTheme>) {
  const { css: _css, ...native } = theme.elevation[2];
  return native;
}

/** The courier's photo in a saffron ring. */
export const PIN_PHOTO = 46;

/** «حيدر · 2 دقيقة» over his photo (N16). */
export function CourierPin({ courier }: { courier: ComingCourier }) {
  const theme = useTheme();
  const t = useT();
  const label =
    courier.etaMinutes === null
      ? courier.firstName
        ? t('merchant.courier_map.pin_no_eta', { name: courier.firstName })
        : t('merchant.courier.on_the_way_no_eta')
      : courier.firstName
        ? t('merchant.courier_map.pin', { name: courier.firstName, minutes: courier.etaMinutes })
        : t('merchant.courier_map.pin_anon', { minutes: courier.etaMinutes });
  return (
    <View testID={`courier-pin-${courier.number}`} style={{ alignItems: 'center' }} pointerEvents="none">
      <View style={{ marginBottom: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, ...lift(theme) }}>
        <Text variant="caption" weight={700} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={{ width: PIN_PHOTO, height: PIN_PHOTO, borderRadius: PIN_PHOTO / 2, borderWidth: 3, borderColor: theme.colors.accent, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center', ...lift(theme) }}>
        <Avatar name={courier.firstName ?? ''} icon={courier.firstName ? undefined : 'user'} uri={courier.photoUrl ? absoluteUrl(courier.photoUrl) : undefined} size={PIN_PHOTO - 8} />
      </View>
    </View>
  );
}

/** «محلك» over the shop. */
export function ShopTag() {
  const theme = useTheme();
  const t = useT();
  return (
    <View pointerEvents="none" style={{ alignItems: 'center' }}>
      <View style={{ paddingHorizontal: 12, paddingVertical: 4, borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent, ...lift(theme) }}>
        <Text variant="caption" weight={700} style={{ color: theme.colors.onAccent }}>
          {t('merchant.courier_map.shop')}
        </Text>
      </View>
      <View style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: theme.colors.accent }} />
    </View>
  );
}

/** «دليفري جايين: 2» in the panel's top corner. */
export function ComingChip({ count }: { count: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: theme.space[3], start: theme.space[3], flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.surface, 0.95), ...lift(theme) }}
    >
      <Icon name="bike" size={16} color="accentText" />
      <Text variant="caption" weight={700}>
        {t('merchant.courier_map.coming', { count })}
      </Text>
    </View>
  );
}
