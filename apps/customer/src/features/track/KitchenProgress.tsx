import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { formatClock, Icon, Text, usePulse, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { kitchenProgressLabel, kitchenStageLabel, type KitchenStage } from './kitchen-progress';

/** Height the strip adds to the collapsed sheet (bars, two label lines, the time). */
export const KITCHEN_PROGRESS_H = 74;

const BAR_H = 6;

/**
 * «شغل المطبخ» (joy l3): four segments under the status line — the kitchen's yes, cooking, ready,
 * the courier has it — lit by real events only. Done stages are palm with their time; cooking, while
 * the kitchen says it is on the fire, is a tea wash with a breathing dot (still under reduce motion);
 * what has not happened is a plain track. One sentence for screen readers.
 */
export function KitchenProgress({ stages, courierName }: { stages: readonly KitchenStage[]; courierName: string | null }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="kitchen-progress" accessible accessibilityLabel={`${t('track.kitchen_title')}: ${kitchenProgressLabel(stages, t, (d) => formatClock(d), courierName)}`} style={{ flexDirection: 'row', gap: theme.space[2] }}>
      {stages.map((s) => (
        <Segment key={s.key} stage={s} label={kitchenStageLabel(s.key, t, courierName)} />
      ))}
    </View>
  );
}

function Segment({ stage, label }: { stage: KitchenStage; label: string }) {
  const theme = useTheme();
  const active = stage.state === 'active';
  const done = stage.state === 'done';
  const pulse = usePulse(active);
  return (
    <View testID={`kitchen-${stage.key}`} style={{ flex: 1, gap: theme.space[1] }}>
      <View style={{ height: BAR_H, borderRadius: BAR_H / 2, backgroundColor: done ? theme.colors.success : active ? theme.colors.accentTint : theme.colors.surfaceSunken, overflow: 'visible', justifyContent: 'center' }}>
        {active ? (
          <View style={{ position: 'absolute', start: 0, width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View style={[{ position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }, pulse]} />
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.accent }} />
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {done ? <Icon name="check" size={12} color="successText" strokeWidth={2.6} /> : null}
        <Text variant="caption" weight={done || active ? 600 : 500} color={done ? 'successText' : active ? 'text' : 'textMuted'} numberOfLines={2} style={{ flexShrink: 1 }}>
          {label}
        </Text>
      </View>
      {stage.at && (done || active) ? (
        <Text variant="caption" color="textMuted" tabular numberOfLines={1}>
          {formatClock(stage.at)}
        </Text>
      ) : null}
    </View>
  );
}
