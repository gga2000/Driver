import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../icons/Icon';
import { usePulse } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type StepState = 'done' | 'current' | 'todo';

export interface TimelineStep {
  key: string;
  label: string;
  /** Real timestamp for done steps ("7:12"), ETA for upcoming ones. */
  time?: string;
  /** Honest delay or context line under the step (warning tone when `late`). */
  note?: string;
  late?: boolean;
}

export interface TimelineProps {
  steps: readonly TimelineStep[];
  /** Key of the step in progress; earlier steps are done, later ones todo. */
  current: string;
  style?: StyleProp<ViewStyle>;
}

export function stepStates(steps: readonly TimelineStep[], current: string): StepState[] {
  const ci = steps.findIndex((s) => s.key === current);
  return steps.map((_, i) => (ci < 0 ? 'todo' : i < ci ? 'done' : i === ci ? 'current' : 'todo'));
}

const DOT = 22;

function Dot({ state }: { state: StepState }) {
  const theme = useTheme();
  const pulse = usePulse(state === 'current');
  if (state === 'done') {
    return (
      <View style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="check" size={13} color="surface" strokeWidth={2.8} />
      </View>
    );
  }
  if (state === 'current') {
    return (
      <View style={{ width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={[{ position: 'absolute', width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: theme.colors.accent }, pulse]} />
        <View
          style={{
            width: DOT,
            height: DOT,
            borderRadius: DOT / 2,
            backgroundColor: theme.colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.onAccent }} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ width: DOT, height: DOT, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface }} />
    </View>
  );
}

/** Order/ride steps with real timestamps; the current step pulses. */
export function Timeline({ steps, current, style }: TimelineProps) {
  const theme = useTheme();
  const states = stepStates(steps, current);
  return (
    <View accessibilityRole="list" style={style}>
      {steps.map((s, i) => {
        const st = states[i]!;
        const last = i === steps.length - 1;
        return (
          <View
            key={s.key}
            accessible
            accessibilityLabel={[s.label, s.time, s.note].filter(Boolean).join('، ')}
            aria-selected={st === 'current'}
            testID={`step-${s.key}-${st}`}
            style={{ flexDirection: 'row', gap: theme.space[3] }}
          >
            <View style={{ width: DOT, alignItems: 'center' }}>
              <Dot state={st} />
              {!last ? (
                <View
                  style={{
                    flex: 1,
                    width: 2,
                    minHeight: 16,
                    marginVertical: 2,
                    borderRadius: 1,
                    backgroundColor: st === 'done' ? theme.colors.success : theme.colors.border,
                  }}
                />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : theme.space[4], marginTop: -2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
                <Text
                  variant={st === 'current' ? 'bodyStrong' : 'body'}
                  color={st === 'todo' ? 'textMuted' : 'text'}
                  style={{ flex: 1 }}
                >
                  {s.label}
                </Text>
                {s.time ? (
                  <Text variant="footnote" color={st === 'current' ? 'accentText' : 'textMuted'} weight={st === 'current' ? 600 : 400} tabular>
                    {s.time}
                  </Text>
                ) : null}
              </View>
              {s.note ? (
                <Text variant="footnote" color={s.late ? 'warningText' : 'textMuted'}>
                  {s.note}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
