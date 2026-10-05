import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { PartnerMerchantPrep, PartnerPay } from '@driver/contracts';
import { Icon, StatusPill, Text, useTheme, type IconName, type StatusTone } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { PAY_KEY } from './logic';

/** Every named pay component, one line each (money & ops §2: "every component named"). */
export function PayLines({ pay, testID = 'pay-lines' }: { pay: PartnerPay; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ gap: theme.space[1] }}>
      {pay.components.map((c, i) => (
        <View key={c.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text variant="label" color="textMuted">
            {t(PAY_KEY[c.key])}
          </Text>
          <Text variant="label" weight={600} tabular color={c.key === 'pickup_compensation' || c.key === 'batch_bonus' ? 'accentText' : 'text'}>
            {amountParam(c.amountIqd, { sign: i > 0 })}
          </Text>
        </View>
      ))}
      {pay.takePct !== null ? (
        <Text variant="caption" color="textMuted">
          {t('partner.offer_take', { pct: pay.takePct })}
        </Text>
      ) : null}
    </View>
  );
}

/** The kitchen's state as a pill: يتحضّر · جاهز بعد 8 دقيقة / جاهز للاستلام. */
export function PrepPill({ prep }: { prep: PartnerMerchantPrep }) {
  const t = useT();
  let label: string;
  let tone: StatusTone;
  let icon: IconName;
  if (prep.state === 'ready' || prep.state === 'picked_up') {
    label = t('partner.offer_prep_ready');
    tone = 'success';
    icon = 'check';
  } else if (prep.state === 'preparing') {
    label = prep.readyInMin ? t('partner.offer_prep_preparing', { minutes: prep.readyInMin }) : t('partner.offer_prep_cooking');
    tone = 'warning';
    icon = 'clock';
  } else {
    label = t('partner.offer_prep_waiting');
    tone = 'neutral';
    icon = 'clock';
  }
  return (
    <View testID="prep-pill">
      <StatusPill label={label} tone={tone} icon={icon} size="sm" />
    </View>
  );
}

/**
 * Pickup → dropoff as two connected nodes. `top`/`bottom` are the nodes' content; the rail and the
 * dots are drawn here so offer and job screens read the same way.
 */
export function RouteNodes({ top, bottom, gap }: { top: ReactNode; bottom: ReactNode; /** Space between the two nodes (default 16). */ gap?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
      <View style={{ alignItems: 'center', paddingTop: 6, width: 16 }}>
        <View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 3, borderColor: theme.colors.text, backgroundColor: theme.colors.surface }} />
        <View style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 4 }} />
        <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: theme.colors.accent }} />
      </View>
      <View style={{ flex: 1, gap: gap ?? theme.space[4] }}>
        {top}
        {bottom}
      </View>
    </View>
  );
}

/** A small key–value chip on the offer: "يبعد 0.8 كم عنك". */
export function MetaChip({ icon, label }: { icon: IconName; label: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.pill, paddingHorizontal: 10, height: 26 }}>
      <Icon name={icon} size={14} color="textMuted" strokeWidth={2} />
      <Text variant="caption" weight={500} color="textMuted" tabular>
        {label}
      </Text>
    </View>
  );
}
