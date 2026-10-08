import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { FoodDoor } from '@driver/contracts';
import { LocalPhoto, Text, useMotionPresets, useTheme, withAlpha } from '@driver/ui';
import { useDoorFactText } from '@/features/doors/DoorTile';
import type { DoorFact } from '@/features/doors/doors';
import { useT } from '@/lib/i18n';
import { DOOR_PHOTOS as PHOTOS } from './photos';

const GAP = 10;

/**
 * The four doors as photo tiles (Ali 2026-10-08, B under A): the first door of the hour gets the
 * wide tile, the next two share a row, the fourth is a wide strip. Each is a real photo with its
 * name and live line on a dark foot; a door with nothing open goes grey but stays (d3).
 */
export function DoorPhotos({
  order,
  facts,
  width,
}: {
  order: readonly FoodDoor[];
  facts: Readonly<Record<FoodDoor, DoorFact>> | null;
  width: number;
}) {
  const half = (width - GAP) / 2;
  const [first, second, third, fourth] = order;
  const presets = useMotionPresets();
  // The tiles rise once, in reading order, then hold still.
  return (
    <View testID="food-doors" style={{ gap: GAP }}>
      {first ? (
        <Animated.View entering={presets.panelIn(presets.staggerDelay(0))}>
          <DoorPhoto
            door={first}
            fact={facts?.[first] ?? null}
            width={width}
            height={Math.round(width * 0.54)}
            big
          />
        </Animated.View>
      ) : null}
      <Animated.View
        entering={presets.panelIn(presets.staggerDelay(1))}
        style={{ flexDirection: 'row', gap: GAP }}
      >
        {second ? (
          <DoorPhoto
            door={second}
            fact={facts?.[second] ?? null}
            width={half}
            height={Math.round(half * 1.0)}
          />
        ) : null}
        {third ? (
          <DoorPhoto
            door={third}
            fact={facts?.[third] ?? null}
            width={half}
            height={Math.round(half * 1.0)}
          />
        ) : null}
      </Animated.View>
      {fourth ? (
        <Animated.View entering={presets.panelIn(presets.staggerDelay(2))}>
          <DoorPhoto
            door={fourth}
            fact={facts?.[fourth] ?? null}
            width={width}
            height={Math.round(width * 0.28)}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

function DoorPhoto({
  door,
  fact,
  width,
  height,
  big = false,
}: {
  door: FoodDoor;
  fact: DoorFact | null;
  width: number;
  height: number;
  big?: boolean;
}) {
  const theme = useTheme();
  const t = useT();
  const say = useDoorFactText();
  const ink = theme.colors.inverse;
  // While the list loads nothing is greyed: a fact arrives, then a closed door quiets.
  const open = fact === null || fact.kind === 'open';
  const name = t(`food.door.${door}`);
  const line = say(fact);
  return (
    <Pressable
      testID={`door-${door}`}
      accessibilityRole="button"
      accessibilityLabel={line ? t('food.door_a11y', { door: name, fact: line }) : name}
      onPress={() => {
        theme.haptic('selection');
        router.push({ pathname: '/food/[door]', params: { door } });
      }}
      style={({ pressed }) => ({
        width,
        height,
        borderRadius: theme.radius.xl,
        overflow: 'hidden',
        backgroundColor: ink,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <LocalPhoto
        source={PHOTOS[door]}
        style={{ position: 'absolute', top: 0, start: 0, width, height, opacity: open ? 1 : 0.42 }}
      />
      <View pointerEvents="none" style={StyleSheet.absoluteFill} aria-hidden accessible={false}>
        <Svg width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <LinearGradient id={`door-shade-${door}`} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0.35" stopColor={ink} stopOpacity={0} />
              <Stop offset="1" stopColor={ink} stopOpacity={0.88} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#door-shade-${door})`} />
        </Svg>
      </View>
      <View
        style={{
          position: 'absolute',
          bottom: theme.space[3],
          start: theme.space[4],
          end: theme.space[4],
        }}
      >
        <Text
          weight={700}
          color="onInverse"
          numberOfLines={1}
          style={{ fontSize: big ? 22 : 18, lineHeight: big ? 30 : 26 }}
        >
          {name}
        </Text>
        {line ? (
          <Text
            variant="label"
            weight={600}
            color={open ? 'onInverseAccent' : 'onInverseMuted'}
            tabular
            numberOfLines={1}
          >
            {line}
          </Text>
        ) : null}
        {big ? (
          <Text variant="caption" color={withAlpha(theme.colors.onInverse, 0.8)} numberOfLines={1}>
            {t(`food.door_hint.${door}`)}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}
