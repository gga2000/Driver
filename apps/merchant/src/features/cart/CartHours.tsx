import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { CartOwnerView, CartUsualHours } from '@driver/contracts';
import { Button, Chip, Text, TextField, useTheme } from '@driver/ui';
import { timeLabel } from '@/features/hours/logic';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useCounterToast } from '@/lib/toast';
import { useCartActions } from './queries';
import { UsualHoursPicker } from './UsualHoursPicker';

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
            <UsualHoursPicker value={usual} onChange={setUsual} />
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
