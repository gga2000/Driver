import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, FadeIn, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import type { CatalogToday } from '@driver/contracts';
import { color } from '@driver/design-tokens';
import { Icon, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { MAP_H, MAP_W, SPOT_MS, SPOTS, spotCaption } from './today';

/** After a tap the loop rests on the chosen spot this long before it carries on. */
const TAP_HOLD_MS = 8000;

/**
 * A map of home (audit d-6): a warm, stylised Aziziyah — the Tigris bending past the town, the bridge
 * with a tuktuk on it, the old market, the three garages on the Baghdad road, houses and palms — drawn
 * from palette tokens only. Six hot spots light up in turn (one 6 s loop) with a caption each; under
 * reduce motion nothing moves and a tap picks the caption. An illustration, not a map widget.
 */
export function WelcomeMap({ today }: { today: CatalogToday | undefined }) {
  const theme = useTheme();
  const t = useT();
  const [active, setActive] = useState(0);
  // The first spot's caption is there from the first paint; captions only fade in once the light moves.
  const [moved, setMoved] = useState(false);
  const holdUntil = useRef(0);

  useEffect(() => {
    if (theme.reduceMotion) return;
    const id = setInterval(() => {
      if (Date.now() < holdUntil.current) return;
      setMoved(true);
      setActive((i) => (i + 1) % SPOTS.length);
    }, SPOT_MS);
    return () => clearInterval(id);
  }, [theme.reduceMotion]);

  const pick = (i: number) => {
    holdUntil.current = Date.now() + TAP_HOLD_MS;
    theme.haptic('selection');
    setMoved(true);
    setActive(i);
  };
  const spot = SPOTS[active]!;
  const caption = spotCaption(spot.key, today, t);
  const fade = theme.reduceMotion || !moved ? undefined : FadeIn.duration(theme.motion.duration.base);

  return (
    <View
      testID="welcome-map"
      style={{ borderRadius: theme.radius['2xl'], backgroundColor: color.primary[50], borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}
    >
      <View style={{ width: '100%', aspectRatio: MAP_W / MAP_H }} accessible accessibilityRole="image" accessibilityLabel={t('welcome_map.a11y')}>
        <HomeDrawing />
        {SPOTS.map((s, i) => (
          <HotSpot key={s.key} index={i} active={i === active} onPress={() => pick(i)} label={spotCaption(s.key, today, t)} />
        ))}
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border, backgroundColor: theme.colors.surface, minHeight: 56 }}
        accessibilityLiveRegion="polite"
      >
        <Animated.View key={`i-${active}`} entering={fade}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={spot.icon} size={18} color="accentText" strokeWidth={2} />
          </View>
        </Animated.View>
        <Animated.View key={`c-${active}`} entering={fade} style={{ flex: 1 }}>
          <Text variant="bodyStrong" testID="welcome-map-caption" numberOfLines={2}>
            {caption}
          </Text>
        </Animated.View>
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {SPOTS.map((s, i) => (
            <View key={s.key} style={{ width: i === active ? 14 : 6, height: 6, borderRadius: 3, backgroundColor: i === active ? theme.colors.accent : theme.colors.border }} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** One hot spot: a 44 px target with a small medallion; the lit one grows, fills orange and breathes a ring. */
function HotSpot({ index, active, onPress, label }: { index: number; active: boolean; onPress: () => void; label: string }) {
  const theme = useTheme();
  const s = SPOTS[index]!;
  const lift = useSharedValue(active ? 1 : 0);
  const ring = useSharedValue(0);
  useEffect(() => {
    lift.value = theme.reduceMotion ? (active ? 1 : 0) : withTiming(active ? 1 : 0, { duration: theme.motion.duration.base, easing: Easing.out(Easing.cubic) });
    ring.value = 0;
    if (active && !theme.reduceMotion) ring.value = withRepeat(withTiming(1, { duration: SPOT_MS * 0.9, easing: Easing.out(Easing.quad) }), 1, false);
  }, [active, lift, ring, theme.reduceMotion, theme.motion.duration.base]);
  const medal = useAnimatedStyle(() => ({ transform: [{ scale: 0.86 + 0.3 * lift.value }] }));
  const halo = useAnimatedStyle(() => ({ opacity: active ? 0.45 * (1 - ring.value) : 0, transform: [{ scale: 1 + 0.9 * ring.value }] }));
  return (
    <Pressable
      testID={`welcome-spot-${s.key}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-selected={active}
      onPress={onPress}
      hitSlop={4}
      style={{ position: 'absolute', left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: 44, height: 44, marginLeft: -22, marginTop: -22, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 34, height: 34, borderRadius: 17, backgroundColor: theme.colors.accent }, halo]} />
      <Animated.View
        pointerEvents="none"
        style={[
          {
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active ? theme.colors.accent : theme.colors.surface,
            borderWidth: 1.5,
            borderColor: active ? theme.colors.accentBorder : theme.colors.border,
            shadowColor: theme.colors.shadow,
            shadowOpacity: active ? 0.22 : 0.1,
            shadowRadius: active ? 8 : 4,
            shadowOffset: { width: 0, height: 2 },
          },
          medal,
        ]}
      >
        <Icon name={s.icon} size={16} color={active ? 'onAccent' : 'accentText'} strokeWidth={2} />
      </Animated.View>
    </Pressable>
  );
}

/** The drawing itself (viewBox 360 × 280). Palette tokens only; no text, so it reads the same in any language. */
function HomeDrawing() {
  const n = color.neutral;
  const p = color.primary;
  const water = color.info;
  const green = color.success;
  const palm = (x: number, y: number, s = 1) => (
    <G key={`palm-${x}-${y}`}>
      <Line x1={x} y1={y} x2={x + 1.5 * s} y2={y - 13 * s} stroke={n[500]} strokeWidth={1.6 * s} strokeLinecap="round" />
      <Ellipse cx={x - 4 * s} cy={y - 14 * s} rx={5.5 * s} ry={2.2 * s} fill={green[500]} opacity={0.75} transform={`rotate(-25 ${x - 4 * s} ${y - 14 * s})`} />
      <Ellipse cx={x + 6 * s} cy={y - 14 * s} rx={5.5 * s} ry={2.2 * s} fill={green[500]} opacity={0.75} transform={`rotate(25 ${x + 6 * s} ${y - 14 * s})`} />
      <Ellipse cx={x + 1.5 * s} cy={y - 16.5 * s} rx={2.4 * s} ry={4.5 * s} fill={green[700]} opacity={0.7} />
    </G>
  );
  const house = (x: number, y: number, w = 16, h = 12, roof: string = n[300]) => (
    <G key={`h-${x}-${y}`}>
      <Rect x={x} y={y} width={w} height={h} rx={1.5} fill={n[0]} stroke={n[300]} strokeWidth={1} />
      <Rect x={x - 1} y={y - 3} width={w + 2} height={3.5} rx={1} fill={roof} />
      <Rect x={x + w / 2 - 2} y={y + h - 6} width={4} height={6} rx={1} fill={n[200]} />
    </G>
  );
  const garage = (x: number, y: number) => (
    <G key={`g-${x}-${y}`}>
      <Path d={`M ${x - 15} ${y + 9} L ${x - 15} ${y - 2} Q ${x} ${y - 12} ${x + 15} ${y - 2} L ${x + 15} ${y + 9} Z`} fill={n[100]} stroke={n[400]} strokeWidth={1.2} />
      <Path d={`M ${x - 8} ${y + 9} L ${x - 8} ${y + 1} L ${x + 8} ${y + 1} L ${x + 8} ${y + 9}`} fill={n[200]} stroke={n[400]} strokeWidth={1} />
      <Rect x={x + 17} y={y + 3} width={11} height={6} rx={2.5} fill={n[0]} stroke={n[400]} strokeWidth={0.9} />
    </G>
  );
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_W} ${MAP_H}`} style={{ position: 'absolute' }}>
      {/* Land, with a few garden plots by the river. */}
      <Rect x={0} y={0} width={MAP_W} height={MAP_H} fill={p[50]} />
      <Path d="M 0 0 L 70 0 C 110 40 150 90 132 140 C 118 182 70 220 0 236 Z" fill={green[50]} />
      <Rect x={14} y={170} width={34} height={22} rx={4} fill={green[100]} opacity={0.7} />
      <Rect x={20} y={36} width={30} height={18} rx={4} fill={green[100]} opacity={0.7} />

      {/* The Tigris: a broad bend past the town, a lighter current down its middle. */}
      <Path d="M 22 -10 C 92 40 160 92 134 146 C 112 192 52 214 -10 286" fill="none" stroke={water[100]} strokeWidth={38} strokeLinecap="round" />
      <Path d="M 22 -10 C 92 40 160 92 134 146 C 112 192 52 214 -10 286" fill="none" stroke={water[50]} strokeWidth={14} strokeLinecap="round" opacity={0.85} />
      <Path d="M 70 40 q 8 -3 16 0 M 128 118 q 8 -3 16 0 M 60 222 q 8 -3 16 0" fill="none" stroke={n[0]} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />

      {/* Roads: the Baghdad road north past the garages, the high street east, a lane south. */}
      <G fill="none" strokeLinecap="round" strokeLinejoin="round">
        <Path d="M 172 152 L 236 150 L 362 168" stroke={n[200]} strokeWidth={12} />
        <Path d="M 236 150 L 268 96 L 312 24 L 326 -6" stroke={n[200]} strokeWidth={11} />
        <Path d="M 236 150 L 300 196 L 362 226" stroke={n[200]} strokeWidth={9} />
        <Path d="M 236 150 L 214 210 L 200 286" stroke={n[200]} strokeWidth={9} />
        <Path d="M 172 152 L 236 150 L 362 168" stroke={n[0]} strokeWidth={8} />
        <Path d="M 236 150 L 268 96 L 312 24 L 326 -6" stroke={n[0]} strokeWidth={7} />
        <Path d="M 236 150 L 300 196 L 362 226" stroke={n[0]} strokeWidth={5.5} />
        <Path d="M 236 150 L 214 210 L 200 286" stroke={n[0]} strokeWidth={5.5} />
        <Path d="M 268 96 L 312 24" stroke={n[300]} strokeWidth={1} strokeDasharray="4 5" />
        <Path d="M 40 150 L 92 116" stroke={n[200]} strokeWidth={8} />
        <Path d="M 40 150 L 92 116" stroke={n[0]} strokeWidth={5} />
      </G>

      {/* The bridge across the river, with its rails. */}
      <Line x1={88} y1={114} x2={174} y2={152} stroke={n[300]} strokeWidth={14} strokeLinecap="round" />
      <Line x1={88} y1={114} x2={174} y2={152} stroke={n[100]} strokeWidth={10} strokeLinecap="round" />
      <Line x1={90} y1={109} x2={176} y2={147} stroke={n[500]} strokeWidth={1.2} />
      <Line x1={86} y1={119} x2={172} y2={157} stroke={n[500]} strokeWidth={1.2} />

      {/* The old market: arcades under striped awnings, a dome and a minaret. */}
      <G>
        <Rect x={244} y={118} width={44} height={22} rx={2} fill={n[0]} stroke={n[300]} strokeWidth={1} />
        <Path d="M 248 140 v -8 a 4 4 0 0 1 8 0 v 8 M 260 140 v -8 a 4 4 0 0 1 8 0 v 8 M 272 140 v -8 a 4 4 0 0 1 8 0 v 8" fill={n[100]} stroke={n[300]} strokeWidth={0.9} />
        <Path d="M 242 118 l 4 -6 h 40 l 4 6 Z" fill={p[300]} />
        <Path d="M 252 112 v 6 M 262 112 v 6 M 272 112 v 6 M 282 112 v 6" stroke={n[0]} strokeWidth={2.5} />
        <Rect x={250} y={160} width={30} height={18} rx={2} fill={n[0]} stroke={n[300]} strokeWidth={1} />
        <Path d="M 248 160 l 3 -5 h 28 l 3 5 Z" fill={p[200]} />
        <Path d="M 196 140 a 11 11 0 0 1 22 0 Z" fill={p[200]} stroke={p[400]} strokeWidth={1} />
        <Rect x={196} y={140} width={22} height={12} fill={n[0]} stroke={n[300]} strokeWidth={1} />
        <Rect x={222} y={118} width={5} height={30} rx={1.5} fill={n[0]} stroke={n[300]} strokeWidth={1} />
        <Circle cx={224.5} cy={116} r={3.2} fill={p[300]} />
      </G>

      {/* The three Aziziyah garages on the Baghdad road. */}
      {garage(300, 52)}
      {garage(246, 86)}
      {garage(328, 100)}

      {/* Houses: the town around the market and down to the south. */}
      {house(176, 222)}
      {house(206, 248, 18, 13, p[200])}
      {house(230, 220)}
      {house(158, 254, 15, 11)}
      {house(312, 132)}
      {house(334, 140, 14, 11, p[200])}
      {house(268, 210)}
      {house(328, 238)}
      {house(180, 178, 14, 11)}

      {/* The west bank: palms along the water and a small post office. */}
      {palm(36, 108)}
      {palm(52, 84, 0.9)}
      {palm(160, 64, 0.9)}
      {palm(178, 100)}
      {palm(96, 250, 0.9)}
      {palm(20, 262)}
      {palm(150, 200, 0.85)}
      <Rect x={40} y={210} width={24} height={16} rx={2} fill={n[0]} stroke={n[300]} strokeWidth={1} />
      <Path d="M 38 210 l 14 -8 l 14 8 Z" fill={n[300]} />

      {/* A small car on the high street. */}
      <Rect x={322} y={163} width={14} height={7} rx={3} fill={n[0]} stroke={n[500]} strokeWidth={1} transform="rotate(8 329 166)" />
    </Svg>
  );
}
