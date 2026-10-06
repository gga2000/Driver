import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { useTheme } from '../theme/ThemeProvider';
import { Button } from './Button';
import { Text } from './Text';

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  /** What to do next (voice spec: an empty screen is an invitation to act). */
  body?: string;
  action?: { label: string; onPress: () => void };
  /** A sketchbook scene (joy J4) in place of the icon tile; the icon stays the fallback. */
  art?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** How wide a drawing grows in an empty state. */
const ART_MAX_WIDTH = 280;

export function EmptyState({ icon, title, body, action, art, style }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View style={[{ alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[8], paddingHorizontal: theme.space[6] }, style]}>
      {art ? (
        <View style={{ width: '100%', maxWidth: ART_MAX_WIDTH, marginBottom: theme.space[1] }}>{art}</View>
      ) : (
      <View
        testID="empty-state-icon"
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          backgroundColor: theme.colors.accentTint,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ rotate: '-6deg' }],
        }}
      >
        <View style={{ transform: [{ rotate: '6deg' }] }}>
          <Icon name={icon} size={32} color="accentText" strokeWidth={1.6} />
        </View>
      </View>
      )}
      <Text variant="title" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="secondary" style={{ alignSelf: 'center', marginTop: theme.space[2] }} /> : null}
    </View>
  );
}
