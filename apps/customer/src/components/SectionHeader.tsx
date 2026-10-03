import { View } from 'react-native';
import { Button, Text, useTheme } from '@driver/ui';

/** Rail / section title with an optional "شوف الكل" action at the end side. */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3], minHeight: 36 }}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>
      {action ? <Button variant="ghost" size="sm" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}
