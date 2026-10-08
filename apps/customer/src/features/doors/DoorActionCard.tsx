import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Icon, Text, useTheme, type DishKind } from '@driver/ui';
import { photoForMotif } from '@/features/food-landing/photos';
import { FoodPhoto } from '@/features/food-landing/FoodPhoto';

/**
 * One calm way in from a door (k10 «اختارلي», s2 «ضيوف جايين؟», q1 «قهوتك المعتادة»): a dark strip
 * over a real photo of what it brings (Ali 2026-10-08, concept A), a title and one gold line, and
 * either the whole strip is the button (a saffron arrow) or it carries its own (the usual's «اطلبها
 * نفسها»). At most one or two per door, never a banner.
 */
export function DoorActionCard({
  art,
  title,
  body,
  onPress,
  action,
  testID,
}: {
  art: DishKind;
  title: string;
  body: string;
  onPress?: () => void;
  action?: ReactNode;
  testID?: string;
}) {
  const theme = useTheme();
  const ink = theme.colors.inverse;
  const inner = (
    <>
      <FoodPhoto photo={photoForMotif(art)} style={{ position: 'absolute', top: 0, start: 0, width: '100%', height: '100%' }} />
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            {/* Darkest under the words (the reading start), the food showing at the far end. */}
            <LinearGradient id={`action-${testID ?? art}`} x1="1" y1="0" x2="0" y2="0">
              <Stop offset="0" stopColor={ink} stopOpacity={0.96} />
              <Stop offset="0.6" stopColor={ink} stopOpacity={0.84} />
              <Stop offset="1" stopColor={ink} stopOpacity={0.45} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#action-${testID ?? art})`} />
        </Svg>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          paddingHorizontal: theme.space[4],
          paddingVertical: theme.space[4],
        }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text
            weight={700}
            color="onInverse"
            numberOfLines={1}
            style={{ fontSize: 18, lineHeight: 28 }}
          >
            {title}
          </Text>
          <Text variant="label" weight={500} color="onInverseAccent" numberOfLines={2}>
            {body}
          </Text>
        </View>
        {action ??
          (onPress ? (
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 23,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: theme.colors.accent,
              }}
            >
              <Icon name="arrow-forward" size={22} color="onAccent" />
            </View>
          ) : null)}
      </View>
    </>
  );
  const box = {
    minHeight: 92,
    justifyContent: 'center',
    borderRadius: theme.radius.xl,
    overflow: 'hidden',
    backgroundColor: ink,
  } as const;
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
