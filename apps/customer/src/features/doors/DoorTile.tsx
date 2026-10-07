import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import Svg, { G } from 'react-native-svg';
import type { FoodDoor } from '@driver/contracts';
import { lift } from '@driver/design-tokens';
import { DishDrawing, Text, usePressScale, useTheme, withAlpha } from '@driver/ui';
import { countKey } from '@/lib/plural';
import { useT } from '@/lib/i18n';
import { DOOR_ART, type DoorFact } from './doors';
import { doorSwatch } from './palette';

/** The arch's rise: the top corners are this share of the tile's width (a shanasheel door, not a card). */
const ARCH = 0.5;
const ART = 96;

/** A door's live line in words. */
export function useDoorFactText(): (fact: DoorFact | null) => string | null {
  const t = useT();
  return (fact) => {
    if (!fact) return null;
    if (fact.kind === 'open') return t(countKey('food.fact_open', fact.n), { n: fact.n });
    if (fact.kind === 'opens') return t('food.fact_opens', { time: fact.at });
    return fact.kind === 'closed' ? t('food.fact_closed') : t('food.fact_none');
  };
}

/**
 * One of the four food doors (idea d2): an arch-topped door in the door's own colour, its drawing
 * standing in the arch, the name and one live fact under it («4 فاتحين هسة», «يفتح 4:00»). A door
 * with nothing open behind it goes quiet but stays: the four never move or vanish (d3).
 */
export function DoorTile({
  door,
  fact,
  width,
  height,
  testID,
}: {
  door: FoodDoor;
  fact: DoorFact | null;
  width: number;
  height: number;
  testID?: string;
}) {
  const theme = useTheme();
  const t = useT();
  const say = useDoorFactText();
  const press = usePressScale();
  // The door swings (Ali's Yes on p2): pressed, its drawing steps forward out of the doorway; let go,
  // it settles back. Nothing moves when the phone asks for less motion.
  const step = useSharedValue(0);
  const stepStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -6 * step.value }, { scale: 1 + 0.08 * step.value }],
  }));
  const s = doorSwatch(theme, door);
  const quiet = fact !== null && fact.kind !== 'open';
  const name = t(`food.door.${door}`);
  const line = say(fact);
  const g = lift.glowOffset;
  const radius = width * ARCH;
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderTopStartRadius: radius,
          borderTopEndRadius: radius,
          borderBottomStartRadius: theme.radius.tile,
          borderBottomEndRadius: theme.radius.tile,
        },
        theme.scheme === 'light' && !quiet
          ? {
              boxShadow: `${g.x}px ${g.y}px ${g.blur}px ${g.spread}px ${withAlpha(s.glow, lift.glowAlpha)}`,
            }
          : null,
        press.style,
      ]}
    >
      <Pressable
        testID={testID ?? `door-${door}`}
        accessibilityRole="button"
        accessibilityLabel={line ? t('food.door_a11y', { door: name, fact: line }) : name}
        onPressIn={() => {
          press.onPressIn();
          if (!theme.reduceMotion) step.value = withSpring(1, theme.motion.spring.press);
        }}
        onPressOut={() => {
          press.onPressOut();
          step.value = withSpring(0, theme.motion.spring.press);
        }}
        onPress={() => {
          theme.haptic('selection');
          router.push({ pathname: '/food/[door]', params: { door } });
        }}
        style={{
          flex: 1,
          overflow: 'hidden',
          backgroundColor: s.fill,
          borderTopStartRadius: radius,
          borderTopEndRadius: radius,
          borderBottomStartRadius: theme.radius.tile,
          borderBottomEndRadius: theme.radius.tile,
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingHorizontal: theme.space[3],
          paddingBottom: theme.space[3],
        }}
      >
        {/* The inner arch: a lighter doorway the drawing stands in. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 10,
            start: 10,
            end: 10,
            height: height * 0.62,
            borderBottomStartRadius: theme.radius.lg,
            borderBottomEndRadius: theme.radius.lg,
            borderTopStartRadius: radius,
            borderTopEndRadius: radius,
            backgroundColor: s.inner,
          }}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: height * 0.1,
              alignSelf: 'center',
              width: ART,
              height: ART,
              opacity: quiet ? 0.55 : 1,
            },
            stepStyle,
          ]}
        >
          <Svg width={ART} height={ART} viewBox="0 0 200 200">
            <G transform="translate(8 6) scale(0.92)">
              <DishDrawing kind={DOOR_ART[door]} look={0} line={4.5} window={false} />
            </G>
          </Svg>
        </Animated.View>
        <Text variant="title" weight={700} align="center" numberOfLines={1} style={{ color: s.on }}>
          {name}
        </Text>
        {line ? (
          <Text
            variant="caption"
            weight={600}
            align="center"
            tabular
            numberOfLines={1}
            style={{ color: s.sub }}
          >
            {line}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
