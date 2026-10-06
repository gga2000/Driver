import { Platform, Switch, View } from 'react-native';
import { Card, ChipGroup, Icon, Text, TextField, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { CARD_MAX, CARD_SUGGESTIONS, hidePricesAllowed } from './gift';

export interface GiftChoiceValue {
  on: boolean;
  hidePrices: boolean;
  card: string;
}

/**
 * «عزيمة؟» (joy g1) at checkout, once someone else receives the order: «هذا الطلب هدية مني», a line
 * with the food (one-tap suggestions or his own words), and «خلي الأسعار مخفية» — only when he pays
 * from his wallet; with cash the switch is off and says why.
 */
export function GiftChoice({ name, payment, value, onChange }: { name: string | null; payment: 'cash' | 'wallet'; value: GiftChoiceValue; onChange: (next: GiftChoiceValue) => void }) {
  const theme = useTheme();
  const t = useT();
  const canHide = hidePricesAllowed(payment);
  const switchProps = (on: boolean) => ({
    trackColor: { true: theme.colors.accent, false: theme.colors.border },
    ...(Platform.OS === 'web' ? { activeThumbColor: theme.colors.surface } : {}),
    value: on,
  });
  const suggestions = CARD_SUGGESTIONS.map((key) => t(key));
  return (
    <Card elevation={0} padding={3} testID="checkout-gift">
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
          <Icon name="gift" size={20} color="accentText" />
          <View style={{ flex: 1 }}>
            <Text variant="label" weight={600}>
              {t('gift.switch')}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('gift.switch_hint', { name: name ?? t('checkout.recipient_other') })}
            </Text>
          </View>
          <Switch testID="checkout-gift-switch" accessibilityLabel={t('gift.switch')} onValueChange={(on) => onChange({ ...value, on })} {...switchProps(value.on)} />
        </View>
        {value.on ? (
          <>
            <ChipGroup
              accessibilityLabel={t('gift.card_label')}
              items={suggestions.map((s) => ({ id: s, label: s }))}
              value={suggestions.includes(value.card) ? [value.card] : []}
              onChange={(v) => onChange({ ...value, card: v[0] ?? '' })}
            />
            <TextField testID="checkout-gift-card" label={t('gift.card_label')} placeholder={t('gift.card_placeholder')} value={value.card} onChangeText={(card) => onChange({ ...value, card })} maxLength={CARD_MAX} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 44 }}>
              <View style={{ flex: 1 }}>
                <Text variant="label" weight={600} color={canHide ? 'text' : 'textMuted'}>
                  {t('gift.hide_prices')}
                </Text>
                <Text variant="caption" color="textMuted" testID="checkout-gift-hide-hint">
                  {canHide ? t('gift.hide_prices_hint') : t('gift.hide_prices_cash')}
                </Text>
              </View>
              <Switch
                testID="checkout-gift-hide"
                accessibilityLabel={t('gift.hide_prices')}
                disabled={!canHide}
                onValueChange={(hidePrices) => onChange({ ...value, hidePrices })}
                {...switchProps(canHide && value.hidePrices)}
              />
            </View>
          </>
        ) : null}
      </View>
    </Card>
  );
}
