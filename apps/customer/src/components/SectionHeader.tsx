import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';

/**
 * Rail / section title with an optional "شوف الكل" action at the end side. `big`: a home-style section
 * title in Alexandria 20 («مفتوح هسة», «شنو بخاطرك؟»; Date & Saffron — the hand-lettered Marhey is kept
 * for the greeting alone, joy J-D2).
 */
export function SectionHeader({ title, action, big }: { title: string; action?: { label: string; onPress: () => void }; big?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3], minHeight: 36 }}>
      <Text variant={big ? 'section' : 'title'} face={big ? 'display' : undefined} accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      {action ? <Button variant="ghost" size="sm" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
