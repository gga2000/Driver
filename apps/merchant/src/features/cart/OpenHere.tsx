import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { AZIZIYAH_CENTRE, AZIZIYAH_ZONES, type CartOwnerView } from '@driver/contracts';
import { Chip, Icon, Text, TextField, useTheme } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { useHere } from './position';
import { useCartActions } from './queries';
import { nearestZone, startingLabel, type Point } from './spot';
import { SPOT_MAP, SpotMap } from './SpotMap';

type Source = 'here' | 'last' | 'zone';

/**
 * «فتحت هنا» (cart owner concept v1, Ali 2026-10-11): one tap tells the town the cart is open and where.
 * The spot is the phone's position when it has one (moving the map fixes it), else last night's spot or
 * the area he picks. He can name the spot («جنب كراج السوق»), and switch tonight's dishes on and off.
 * His followers hear «{name} فتح» once a night.
 */
export function OpenHere({ view }: { view: CartOwnerView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const actions = useCartActions();
  const here = useHere();
  const { cart } = view;
  const last = cart.spot;

  const [moved, setMoved] = useState<Point | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const source: Source = here.state === 'here' ? 'here' : zoneId === null && last ? 'last' : 'zone';
  const base: Point = here.state === 'here' ? here.at : source === 'last' && last ? last : (AZIZIYAH_ZONES.find((z) => z.id === zoneId) ?? AZIZIYAH_CENTRE);
  const at = moved ?? base;
  const zone = nearestZone(at);
  const place = locale === 'en' ? zone.name_en : zone.name_ar;
  const [label, setLabel] = useState<string | null>(null);
  const shownLabel = label ?? startingLabel(at, last);
  const showMap = SPOT_MAP && !mapFailed;

  const open = () =>
    actions.openHere.mutate(
      { merchantOrgId: cart.merchantOrgId, at, ...(shownLabel.trim() ? { label: shownLabel.trim() } : {}) },
      { onError: (e) => toast.show({ tone: 'danger', message: apiErrorMessage(e, t('merchant.cart.failed'), locale) }) },
    );

  const zones = useMemo(() => AZIZIYAH_ZONES.slice().sort((a, b) => a.name_ar.localeCompare(b.name_ar, 'ar')), []);

  return (
    <View style={{ gap: theme.space[5] }} testID="cart-open">
      {showMap ? (
        <SpotMap
          at={base}
          height={300}
          bubble={t(source === 'here' && !moved ? 'merchant.cart.bubble_here' : 'merchant.cart.bubble_cart', { place: shownLabel.trim() || place })}
          onMove={(p) => setMoved(p)}
          onFail={() => setMapFailed(true)}
        />
      ) : null}

      {here.state !== 'here' ? (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="heading" face="display">
            {t('merchant.cart.where_title')}
          </Text>
          {here.state === 'asking' ? (
            <Text variant="footnote" color="textMuted">
              {t('merchant.cart.finding_you')}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {last ? (
              <Chip
                label={last.label ? t('merchant.cart.same_spot_named', { place: last.label }) : t('merchant.cart.same_spot')}
                icon="map-pin"
                role="radio"
                selected={source === 'last'}
                onPress={() => {
                  setZoneId(null);
                  setMoved(null);
                  setLabel(null);
                }}
                testID="cart-spot-last"
              />
            ) : null}
          </View>
          <Text variant="footnote" color="textMuted">
            {t('merchant.cart.or_area')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {zones.map((z) => (
              <Chip
                key={z.id}
                label={locale === 'en' ? z.name_en : z.name_ar}
                role="radio"
                selected={source === 'zone' && (zoneId ?? 'centre') === z.id}
                onPress={() => {
                  setZoneId(z.id);
                  setMoved(null);
                  setLabel(null);
                }}
                testID={`cart-zone-${z.id}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <TextField
        label={t('merchant.cart.label_title')}
        placeholder={t('merchant.cart.label_hint')}
        value={shownLabel}
        onChangeText={setLabel}
        maxLength={60}
        hint={t('merchant.cart.label_help', { place })}
        testID="cart-label"
      />

      <OpenButton busy={actions.openHere.isPending} onPress={open} label={t('merchant.cart.open_here')} />

      <View style={{ gap: theme.space[3] }}>
        <Text variant="heading" face="display">
          {t('merchant.cart.dishes_title')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {cart.dishes.map((d) => (
            <Chip
              key={d.itemId}
              label={d.nameAr}
              role="checkbox"
              selected={d.available}
              onPress={() => actions.dish.mutate({ merchantOrgId: cart.merchantOrgId, itemId: d.itemId, available: !d.available }, { onError: (e) => toast.show({ tone: 'danger', message: apiErrorMessage(e, t('merchant.cart.failed'), locale) }) })}
              testID={`cart-dish-${d.itemId}`}
            />
          ))}
          <Chip label={t('merchant.cart.dishes_more')} icon="plus" role="button" onPress={() => router.push('/menu')} testID="cart-dish-more" />
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
        <Icon name="bell" size={18} color={theme.colors.textMuted} />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('merchant.cart.open_note', { name: cart.name })}
        </Text>
      </View>
    </View>
  );
}

/** The big fuchsia «فتحت هنا» (v1): ink circle with the arrow at the end the thumb reaches. */
function OpenButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  const theme = useTheme();
  const c = theme.services.carts;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      testID="cart-open-here"
      style={({ pressed }) => ({ minHeight: 88, borderRadius: 44, backgroundColor: c.fill, flexDirection: 'row', alignItems: 'center', paddingStart: theme.space[6], paddingEnd: theme.space[3], opacity: pressed ? 0.88 : 1 })}
    >
      <Text variant="display" face="display" style={{ flex: 1, color: c.on }}>
        {label}
      </Text>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.on, alignItems: 'center', justifyContent: 'center' }}>
        {busy ? <ActivityIndicator color={c.fill} /> : <Icon name="arrow-forward" size={30} color={c.fill} />}
      </View>
    </Pressable>
  );
}
