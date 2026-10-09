import { useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { AGREEMENT_MAX_IQD, AGREEMENT_STEP_IQD, type AgreementView } from '@driver/contracts';
import { Button, Chip, Icon, IconButton, ModalSheet, Rule, StatusPill, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { openNav, useNavApp } from '@/features/work/nav';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { agreedPrice, riderName } from './labels';
import { haversineM, mapsUrl, type LatLngLike } from './logic';

/** Quick amounts on the price sheet: free first (Ali's «ممكن ببلاش»), then the usual ones. */
export const QUICK_PRICES = [0, 1_000, 2_000, 3_000, 5_000] as const;

/**
 * Step 4: riders' price asks on this run («طلبات سعر»): a pickup at his spot on the road or a drop at his
 * door. The driver names the price on a sheet (whole 1,000s, ببلاش allowed); the rider agrees in his app.
 */
export function PriceAsks({
  asks,
  garage,
  onPrice,
}: {
  asks: readonly AgreementView[];
  /** The departure garage, for how far a pin is from it. */
  garage: LatLngLike | null;
  onPrice: (a: AgreementView) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const navApp = useNavApp().app;
  return (
    <View testID="ic-price-asks" style={{ gap: 0 }}>
      {asks.map((a, i) => {
        const pin = a.kind === 'pin_pickup';
        const name = riderName(t, a.riderFirstName);
        const km = pin && garage ? haversineM(garage, a) / 1000 : null;
        const icon: IconName = pin ? 'map-pin' : 'home';
        return (
          <View key={a.id}>
            {i > 0 ? <Rule /> : null}
            <View testID={`ask-${a.id}`} style={{ gap: theme.space[2], paddingVertical: theme.space[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: a.state === 'asked' ? theme.colors.accentTint : theme.colors.surfaceSunken }}>
                  <Icon name={icon} size={20} color={a.state === 'asked' ? 'accentText' : 'textMuted'} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, gap: 0 }}>
                  <Text variant="label" weight={700} numberOfLines={1}>
                    {t(pin ? 'partner.ic_agree_pin' : 'partner.ic_agree_door', { name })}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={2} tabular>
                    {[a.note, km !== null ? t('partner.ic_agree_km', { km: km.toFixed(0) }) : null].filter(Boolean).join(' · ') || t('partner.ic_agree_no_note')}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: theme.space[2], paddingStart: 52 }}>
                <Pressable
                  testID={`ask-map-${a.id}`}
                  accessibilityRole="link"
                  hitSlop={6}
                  onPress={() => void (navApp ? openNav(navApp, a) : Linking.openURL(mapsUrl(a))).catch(() => undefined)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, minHeight: 44, borderRadius: 22, backgroundColor: withAlpha(theme.colors.info, 0.1) }}
                >
                  <Icon name="location-arrow" size={14} color="infoText" strokeWidth={2} />
                  <Text variant="caption" weight={600} color="infoText">
                    {t('partner.ic_agree_map')}
                  </Text>
                </Pressable>
                {a.state === 'asked' ? (
                  <View style={{ flex: 1 }}>
                    <Button testID={`ask-price-${a.id}`} label={t('partner.ic_agree_price_cta')} size="sm" icon="cash" fullWidth onPress={() => onPrice(a)} />
                  </View>
                ) : (
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: theme.space[2], flexWrap: 'wrap' }}>
                    {a.state === 'proposed' ? (
                      <>
                        <StatusPill size="sm" tone="info" icon="clock" label={t('partner.ic_agree_waiting', { price: agreedPrice(t, a.amountIqd ?? 0) })} testID={`ask-state-${a.id}`} />
                        <Button testID={`ask-reprice-${a.id}`} label={t('partner.ic_agree_reprice')} size="sm" variant="ghost" onPress={() => onPrice(a)} />
                      </>
                    ) : (
                      <StatusPill size="sm" tone="success" icon="check" label={t('partner.ic_agree_agreed', { price: agreedPrice(t, a.amountIqd ?? 0) })} testID={`ask-state-${a.id}`} />
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** The price sheet: ببلاش and the usual amounts as chips, then −/+ by 1,000 up to 25,000. */
export function PriceSheet({
  ask,
  busy,
  error,
  onClose,
  onSend,
}: {
  ask: AgreementView | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSend: (amountIqd: number) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [thousands, setThousands] = useState<number | null>(null);
  const start = ask?.amountIqd ?? 2_000;
  const amount = (thousands ?? start / AGREEMENT_STEP_IQD) * AGREEMENT_STEP_IQD;
  const close = () => {
    setThousands(null);
    onClose();
  };
  return (
    <ModalSheet
      visible={!!ask}
      onClose={close}
      title={t('partner.ic_agree_sheet_title')}
      subtitle={ask ? t(ask.kind === 'pin_pickup' ? 'partner.ic_agree_pin' : 'partner.ic_agree_door', { name: riderName(t, ask.riderFirstName) }) : undefined}
      testID="ic-price-sheet"
      footer={
        <Button
          testID="ic-price-send"
          label={t('partner.ic_agree_send', { price: agreedPrice(t, amount) })}
          icon="send"
          size="lg"
          fullWidth
          loading={busy}
          onPress={() => {
            onSend(amount);
            setThousands(null);
          }}
        />
      }
    >
      <View style={{ gap: theme.space[4] }}>
        <Text variant="footnote" color="textMuted">
          {t('partner.ic_agree_sheet_hint')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} accessibilityRole="radiogroup">
          {QUICK_PRICES.map((p) => (
            <Chip key={p} testID={`ic-price-${p}`} role="radio" label={agreedPrice(t, p)} selected={amount === p} onPress={() => setThousands(p / AGREEMENT_STEP_IQD)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
          <IconButton
            testID="ic-price-less"
            icon="minus"
            variant="outline"
            accessibilityLabel={t('partner.ic_agree_less')}
            disabled={amount <= 0}
            onPress={() => setThousands(Math.max(0, amount / AGREEMENT_STEP_IQD - 1))}
          />
          <Text variant="title" tabular accessibilityLiveRegion="polite" testID="ic-price-amount">
            {amount === 0 ? t('partner.ic_agree_free') : t('partner.ic_agree_amount', { amount: amountParam(amount) })}
          </Text>
          <IconButton
            testID="ic-price-more"
            icon="plus"
            variant="outline"
            accessibilityLabel={t('partner.ic_agree_more')}
            disabled={amount >= AGREEMENT_MAX_IQD}
            onPress={() => setThousands(Math.min(AGREEMENT_MAX_IQD, amount + AGREEMENT_STEP_IQD) / AGREEMENT_STEP_IQD)}
          />
        </View>
        {error ? (
          <Text variant="footnote" color="dangerText" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </ModalSheet>
  );
}
