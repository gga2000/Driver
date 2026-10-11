import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CartOwnerView, CartUsualHours } from '@driver/contracts';
import { Button, Chip, Text, TextField, useTheme } from '@driver/ui';
import { timeChoices, timeLabel } from '@/features/hours/logic';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { useCartActions } from './queries';

type Side = 'from' | 'to';

/** A cart's evening starts the list: most carts open after noon. */
const HOURS = (() => {
  const all = timeChoices(60);
  const noon = all.indexOf('12:00');
  return [...all.slice(noon), ...all.slice(0, noon)];
})();
const STARTING: CartUsualHours = { from: '18:00', to: '00:00' };
const AWAY_IDEAS = ['merchant.cart.away_idea_travel', 'merchant.cart.away_idea_eid', 'merchant.cart.away_idea_fix'] as const;

/**
 * «أوقاتك والإجازة» (Ali 2026-10-11, "two pieces, then finish"): the cart's usual hours and an away
 * note. Customers see «يفتح عادة 6 المسا» on the cart while it is closed, or the note instead
 * («مسافر، نرجع الخميس»); the note goes by itself the next time he taps «فتحت هنا». A card on top shows
 * the line people will read.
 */
export function CartHours({ view }: { view: CartOwnerView }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const save = useCartActions().settings;
  const { cart } = view;
  const c = theme.services.carts;

  const [usual, setUsual] = useState<CartUsualHours | null>(cart.usual);
  const [side, setSide] = useState<Side>('from');
  const [away, setAway] = useState(cart.awayNote ?? '');
  const note = away.trim();
  const preview = note ? note : usual ? t('merchant.cart.preview_usual', { time: timeLabel(t, usual.from) }) : t('merchant.cart.preview_closed');

  const submit = () =>
    save.mutate(
      { merchantOrgId: cart.merchantOrgId, usual, awayNote: note || null },
      {
        onError: (e) => toast.show({ tone: 'danger', message: apiErrorMessage(e, t('merchant.cart.failed'), locale) }),
        onSuccess: () => {
          toast.show({ tone: 'success', icon: 'check', message: t('merchant.cart.hours_saved') });
          router.back();
        },
      },
    );

  return (
    <View style={{ gap: theme.space[6] }} testID="cart-hours">
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('merchant.cart.preview_title')}
        </Text>
        <View testID="cart-hours-preview" style={{ borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, padding: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[3], ...theme.elevation[1] }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: c.fill }} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text variant="heading" face="display" numberOfLines={1}>
              {cart.name}
            </Text>
            <Text variant="body" color="textMuted" numberOfLines={2}>
              {preview}
            </Text>
          </View>
        </View>
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="heading" face="display">
          {t('merchant.cart.usual_title')}
        </Text>
        {usual ? (
          <>
            <View style={{ flexDirection: 'row', gap: theme.space[2] }} accessibilityRole="tablist">
              {(['from', 'to'] as const).map((k) => {
                const selected = side === k;
                return (
                  <Pressable
                    key={k}
                    testID={`cart-usual-${k}`}
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    onPress={() => setSide(k)}
                    style={{ flex: 1, minHeight: 64, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.lg, borderWidth: selected ? 2 : 1, borderColor: selected ? c.fill : theme.colors.border, backgroundColor: theme.colors.surface, gap: 2, justifyContent: 'center' }}
                  >
                    <Text variant="caption" color="textMuted" weight={600}>
                      {k === 'from' ? t('merchant.cart.usual_from') : t('merchant.cart.usual_to')}
                    </Text>
                    <Text variant="title" tabular>
                      {timeLabel(t, usual[k])}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} testID={`cart-usual-hours-${side}`}>
              {HOURS.map((h) => {
                const selected = usual[side] === h;
                return (
                  <Pressable
                    key={h}
                    testID={`cart-usual-hour-${h.slice(0, 2)}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      theme.haptic('selection');
                      setUsual({ ...usual, [side]: h });
                      if (side === 'from') setSide('to');
                    }}
                    style={({ pressed }) => ({ width: '22%', minWidth: 76, flexGrow: 1, height: 44, borderRadius: theme.radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: selected ? 2 : 1, borderColor: selected ? c.fill : theme.colors.border, backgroundColor: selected || pressed ? theme.colors.surfaceSunken : theme.colors.surface })}
                  >
                    <Text variant="label" weight={selected ? 700 : 500}>
                      {timeLabel(t, h)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Button label={t('merchant.cart.usual_none')} variant="ghost" onPress={() => setUsual(null)} testID="cart-usual-none" />
          </>
        ) : (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="body" color="textMuted">
              {t('merchant.cart.usual_none_body')}
            </Text>
            <Button label={t('merchant.cart.usual_set')} variant="secondary" icon="clock" onPress={() => setUsual(cart.usual ?? STARTING)} testID="cart-usual-set" />
          </View>
        )}
      </View>

      <View style={{ gap: theme.space[3] }}>
        <Text variant="heading" face="display">
          {t('merchant.cart.away_title')}
        </Text>
        <TextField
          label={t('merchant.cart.away_label')}
          value={away}
          onChangeText={setAway}
          maxLength={60}
          hint={t('merchant.cart.away_hint')}
          testID="cart-away"
        />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {AWAY_IDEAS.map((k) => (
            <Chip key={k} label={t(k)} role="button" onPress={() => setAway(t(k))} testID={`cart-away-${k.split('_').pop()}`} />
          ))}
        </View>
      </View>

      <Button label={t('merchant.cart.hours_save')} size="lg" fullWidth loading={save.isPending} onPress={submit} testID="cart-hours-save" />
    </View>
  );
}
