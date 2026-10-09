import { View } from 'react-native';
import { Button, Icon, Stepper, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { clockLabel } from './logic';

/**
 * Step 5 (Ali's item 51): on the board and the seat screen of the way back, when he has a seat out on
 * this road: booking this car takes the percent off both seats.
 */
export function ReturnBundleStrip({ percent, outAt, testID = 'rajaa-return-strip' }: { percent: number; outAt: Date; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID={testID}
      accessibilityRole="text"
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.accentTint }}
    >
      <Icon name="swap" size={20} color="accentText" strokeWidth={2} />
      <Text variant="footnote" weight={600} style={{ flex: 1 }}>
        {t('rajaa.return_bundle_strip', { percent, time: clockLabel(outAt) })}
      </Text>
    </View>
  );
}

/** Step 5: on his booked seat's pass, before the car leaves: book the way back now for the percent off both. */
export function ReturnBundleCard({ percent, onPress }: { percent: number; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View
      testID="rajaa-return-offer"
      style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1.5, borderColor: theme.colors.accent, backgroundColor: theme.colors.surface }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="swap" size={22} color="accentText" strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={700}>
            {t('rajaa.return_bundle_title', { percent })}
          </Text>
          <Text variant="caption" color="textMuted">
            {t('rajaa.return_bundle_body')}
          </Text>
        </View>
      </View>
      <Button testID="rajaa-return-offer-cta" variant="secondary" icon="rajaa" fullWidth label={t('rajaa.return_bundle_cta')} onPress={onPress} />
    </View>
  );
}

/** Step 5: the pair is booked. The later seat carries the saving; the earlier one says where it went. */
export function ReturnPairedLine({ savedIqd }: { savedIqd: number }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="rajaa-return-paired" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Icon name="swap" size={16} color="successText" strokeWidth={2} />
      <Text variant="footnote" color="successText" weight={600} style={{ flex: 1 }}>
        {savedIqd > 0 ? t('rajaa.return_paired_saved', { amount: amountParam(savedIqd) }) : t('rajaa.return_paired_other')}
      </Text>
    </View>
  );
}

/** Step 5 (Ali's item 52): small children on a lap ride free; one per seat, never on the front seat. */
export function LapChildRow({ value, max, onChange }: { value: number; max: number; onChange: (n: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const on = value > 0;
  return (
    <View testID="rajaa-lap" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56, paddingVertical: theme.space[2] }}>
      <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: on ? theme.colors.accentTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="family" size={20} color={on ? 'accentText' : 'textMuted'} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={600}>
          {t('rajaa.lap_title')}
        </Text>
        <Text variant="caption" color="textMuted">
          {max > 0 ? t('rajaa.lap_hint') : t('rajaa.lap_hint_none')}
        </Text>
      </View>
      <Stepper size="sm" value={Math.min(value, max)} min={0} max={max} onChange={onChange} accessibilityLabel={t('rajaa.lap_title')} />
    </View>
  );
}
