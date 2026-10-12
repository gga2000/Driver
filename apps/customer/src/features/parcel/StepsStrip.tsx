import { View } from 'react-native';
import type { ParcelState, ParcelStep } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { formatClock, Text, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { strip } from './logic';
import { parcelSwatch } from './palette';

const STEP_KEY: Record<ParcelStep['key'], MessageKey> = {
  sent: 'parcel.c_step_sent',
  door_set: 'parcel.c_step_door_set',
  picked_up: 'parcel.c_step_picked_up',
  delivered: 'parcel.c_step_delivered',
};

/**
 * The tag's strip (concepts B1/A3): four bars in reading order — sent, door set, picked up, delivered —
 * henna once done with the real time under it, the next one in ink, the rest pale. Words, not only colour.
 */
export function StepsStrip({ steps, state, testID = 'parcel-steps' }: { steps: readonly ParcelStep[]; state: ParcelState; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const sw = parcelSwatch(theme);
  const rows = strip(steps, state);
  return (
    <View testID={testID} style={{ flexDirection: 'row', gap: theme.space[2] }}>
      {rows.map((s) => (
        <View key={s.key} style={{ flex: 1, gap: theme.space[2] }} accessible accessibilityLabel={`${t(STEP_KEY[s.key])}${s.at ? ` ${formatClock(s.at, { locale })}` : ''}`} testID={`${testID}-${s.key}`}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: s.phase === 'done' ? sw.fill : s.phase === 'current' ? theme.colors.borderStrong : theme.colors.border }} />
          <Text variant="caption" weight={s.phase === 'todo' ? 400 : 600} color={s.phase === 'todo' ? 'textMuted' : 'text'} numberOfLines={2}>
            {t(STEP_KEY[s.key])}
          </Text>
          {s.at ? (
            <Text variant="caption" color="textMuted" tabular style={{ marginTop: -theme.space[2] }}>
              {formatClock(s.at, { locale })}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
