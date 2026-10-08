import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { COUNTER } from '@/lib/counter';

export interface ShutterProps {
  storeName: string;
  open: boolean;
  /** «مفتوح لحد 12 بالليل» / «مسدود · يرجع 1:15». */
  line: string;
  /** Taped to the shutter when it opens again by itself: «نرجع 1:15». */
  note?: string | null;
  /** What a tap does, read out: «دوس حتى تسد المحل». */
  hint: string;
  label: string;
  disabled?: boolean;
  wide: boolean;
  onPress: () => void;
}

const GROOVES = 9;

/**
 * «الكبنك» (counter step 5, h1, j5): the shop front with its rolling shutter, the same one customers see
 * on a closed shop's door. Up, the shop is lit and taking orders; down, it is closed. One tap on it
 * opens or closes the shop; the shutter rolls (and just jumps when the phone asks for less motion).
 */
export function Shutter({ storeName, open, line, note, hint, label, disabled, wide, onPress }: ShutterProps) {
  const theme = useTheme();
  const [h, setH] = useState(0);
  const down = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    const to = open ? 0 : 1;
    down.value = theme.reduceMotion ? to : withTiming(to, { duration: 900, easing: Easing.bezier(0.33, 0, 0.2, 1) });
  }, [open, theme.reduceMotion, down]);
  const roll = useAnimatedStyle(() => ({ transform: [{ translateY: (down.value - 1) * h }] }));
  const height = wide ? 230 : 180;

  return (
    <Pressable
      testID="shutter"
      accessibilityRole="switch"
      accessibilityState={{ checked: open, disabled: !!disabled }}
      accessibilityLabel={label}
      accessibilityHint={hint}
      disabled={disabled}
      onPress={() => {
        theme.haptic(open ? 'heavy' : 'medium');
        onPress();
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.94 : 1, transform: [{ scale: pressed && !theme.reduceMotion ? 0.99 : 1 }] })}
    >
      <View style={{ borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: COUNTER.date, padding: 10, gap: 10 }}>
        {/* The sign over the door. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: 6 }}>
          <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: open ? COUNTER.onDateReady : COUNTER.onDateLate }} />
          <Text weight={700} numberOfLines={1} style={[theme.face('display'), { flex: 1, color: COUNTER.onDate, fontSize: wide ? 20 : 18, lineHeight: wide ? 30 : 27 }]}>
            {storeName}
          </Text>
          <Text weight={600} numberOfLines={1} style={{ color: open ? COUNTER.onDateReady : COUNTER.onDateLate, fontSize: 14, lineHeight: 20 }}>
            {line}
          </Text>
        </View>

        {/* The doorway: the lit shop behind, the shutter in front. */}
        <View onLayout={(e) => setH(e.nativeEvent.layout.height)} style={{ height, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: COUNTER.glow }}>
          <ShopInside wide={wide} />
          <Animated.View style={[{ position: 'absolute', top: 0, start: 0, end: 0, height: '100%', backgroundColor: COUNTER.shutter }, roll]}>
            {Array.from({ length: GROOVES }, (_, i) => (
              <View key={i} style={{ flex: 1, borderBottomWidth: 3, borderBottomColor: COUNTER.shutterGroove, borderTopWidth: 1, borderTopColor: withAlpha('#FFFFFF', 0.28) }} />
            ))}
            {/* The handle at the bottom edge. */}
            <View style={{ position: 'absolute', bottom: 10, alignSelf: 'center', width: 64, height: 10, borderRadius: 5, backgroundColor: COUNTER.shutterBox }} />
            {note ? (
              <View style={{ position: 'absolute', top: '30%', alignSelf: 'center', paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], borderRadius: 6, backgroundColor: COUNTER.paper, transform: [{ rotate: '-3deg' }], shadowColor: COUNTER.date, shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 }}>
                <Text weight={700} tabular style={[theme.face('display'), { color: COUNTER.date, fontSize: wide ? 20 : 18, lineHeight: wide ? 30 : 27 }]}>
                  {note}
                </Text>
              </View>
            ) : null}
          </Animated.View>
          {/* The box the shutter rolls into. */}
          <View style={{ position: 'absolute', top: 0, start: 0, end: 0, height: 14, backgroundColor: COUNTER.shutterBox }} />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], minHeight: 28 }}>
          <MIcon name={open ? 'power' : 'store'} size={16} color={COUNTER.onDateMuted} strokeWidth={2} />
          <Text variant="caption" weight={600} style={{ color: COUNTER.onDateMuted }}>
            {hint}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/** Behind the shutter: a lit counter with a tray, a kettle and a hanging lamp, drawn in plain shapes. */
function ShopInside({ wide }: { wide: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <View style={{ position: 'absolute', top: 14, alignSelf: 'center', width: 2, height: 30, backgroundColor: COUNTER.shutterBox }} />
      <View style={{ position: 'absolute', top: 42, alignSelf: 'center', width: 46, height: 22, borderTopStartRadius: 23, borderTopEndRadius: 23, backgroundColor: COUNTER.newBadge }} />
      <View style={{ position: 'absolute', top: 64, alignSelf: 'center', width: 84, height: 18, borderRadius: 42, backgroundColor: withAlpha('#FFFFFF', 0.55) }} />
      {/* A shelf of jars on the back wall (tablet: the phone's doorway is too short for it). */}
      {wide ? (
        <View style={{ position: 'absolute', top: 104, start: theme.space[6], end: theme.space[6], flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          {[22, 30, 18, 26, 22, 30].map((jh, i) => (
            <View key={i} style={{ width: 16, height: jh, borderTopStartRadius: 4, borderTopEndRadius: 4, backgroundColor: i % 2 ? COUNTER.qty : COUNTER.ready, opacity: 0.75 }} />
          ))}
        </View>
      ) : null}
      {wide ? <View style={{ position: 'absolute', top: 134, start: theme.space[5], end: theme.space[5], height: 4, borderRadius: 2, backgroundColor: COUNTER.shutterBox }} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-evenly', paddingHorizontal: theme.space[5] }}>
        <View style={{ width: wide ? 90 : 70, height: 18, borderTopStartRadius: 9, borderTopEndRadius: 9, backgroundColor: COUNTER.saffron }} />
        <View style={{ width: 30, height: 34, borderTopStartRadius: 10, borderTopEndRadius: 10, backgroundColor: COUNTER.dateRaised }} />
        <View style={{ width: wide ? 70 : 54, height: 14, borderTopStartRadius: 7, borderTopEndRadius: 7, backgroundColor: COUNTER.ready }} />
      </View>
      <View style={{ height: 38, backgroundColor: COUNTER.dateRaised, borderTopWidth: 4, borderTopColor: COUNTER.newBadge }} />
    </View>
  );
}
