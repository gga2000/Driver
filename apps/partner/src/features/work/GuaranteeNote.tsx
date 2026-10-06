import { View } from 'react-native';
import { Icon, Text, useTheme } from '@driver/ui';
import type { GuaranteeLine, GuaranteeTone } from './guarantee-logic';

const TONE_COLOR: Record<GuaranteeTone, 'accentText' | 'warningText' | 'successText'> = {
  progress: 'accentText',
  warning: 'warningText',
  earned: 'successText',
  paid: 'successText',
};

/**
 * One G-91 shift-guarantee line (the server's numbers, words from `guarantee-logic`): the shield and
 * the sentence, coloured by what it says — progress in the accent, a condition at risk in amber, money
 * earned or paid in green.
 */
export function GuaranteeNote({ line, align = 'start', testID }: { line: GuaranteeLine; align?: 'start' | 'center'; testID?: string }) {
  const theme = useTheme();
  const color = TONE_COLOR[line.tone];
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={line.text}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: align === 'center' ? 'center' : 'flex-start', gap: theme.space[2] }}
    >
      <Icon name="shield" size={16} color={color} strokeWidth={2.2} />
      <Text variant="footnote" color={color} weight={600} tabular align={align === 'center' ? 'center' : undefined} style={{ flexShrink: 1 }}>
        {line.text}
      </Text>
    </View>
  );
}
