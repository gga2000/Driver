import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { DishDrawing, Icon, Text, useTheme, type DishKind } from '@driver/ui';
import type { DoorSwatch } from './palette';

const ART = 56;

/**
 * One calm way in from a door (k10 «اختارلي», s2 «ضيوف جايين؟», q1 «قهوتك المعتادة»): a drawing on the
 * door's colour, a title and one line, and either the whole card is the button or it carries its own
 * (the usual's «اطلبها نفسها»). At most one or two per door, never a banner.
 */
export function DoorActionCard({
  art,
  title,
  body,
  swatch,
  onPress,
  action,
  testID,
}: {
  art: DishKind;
  title: string;
  body: string;
  swatch: DoorSwatch;
  onPress?: () => void;
  action?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const inner = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      <View style={{ width: ART, height: ART, borderRadius: ART / 2, backgroundColor: swatch.fill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        <Svg width={ART - 4} height={ART - 4} viewBox="0 0 200 200">
          <G transform="translate(6 2) scale(0.94)">
            <DishDrawing kind={art} look={0} line={5.5} window={false} />
          </G>
        </Svg>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyStrong" weight={700} numberOfLines={1}>
          {title}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={2}>
          {body}
        </Text>
      </View>
      {action ?? (onPress ? <Icon name="chevron-forward" size={20} color="textMuted" /> : null)}
    </View>
  );
  const box = { padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border } as const;
  if (!onPress) {
    return (
      <View style={box} testID={testID}>
        {inner}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}، ${body}`}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={({ pressed }) => [box, { transform: [{ scale: pressed ? 0.98 : 1 }] }]}
    >
      {inner}
    </Pressable>
  );
}
