import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';

/**
 * Rail / section title with an optional "شوف الكل" action at the end side. `voice`: the title in the
 * hand-lettered Marhey (joy J-D2, home's «مفتوح هسة»); a title with a number falls back to Alexandria.
 */
export function SectionHeader({ title, action, voice }: { title: string; action?: { label: string; onPress: () => void }; voice?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3], minHeight: 36 }}>
      <Text variant={voice ? 'voice' : 'title'} face={voice ? 'voice' : undefined} accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {action ? <Button variant="ghost" size="sm" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
