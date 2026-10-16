import { useState } from 'react';
import { Image, View, type ImageSourcePropType, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { themes } from '@driver/design-tokens';
import { t, type MessageKey } from '@driver/i18n';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { seatIds, toggleSeat, type CarArtLayout, type SeatId, type SeatInfo, type SeatLayout, type SeatState, type SelectRejection } from '../logic/seats';
import { AnimatedPressable, usePressScale, useSelectSpring } from '../motion/motion';
import { useTheme } from '../theme/ThemeProvider';
import { seatLabel, seatPremium } from './SeatMap';
import { Text } from './Text';

export interface CarSeatArtProps {
  /** The car's top-down picture (front up, driver on the left) and where its seats are. */
  art: CarArtLayout & { source: ImageSourcePropType };
  /** Accessible name of the car ("النترا"); the picture itself is decorative. */
  carName?: string;
  layout: SeatLayout;
  seats: readonly SeatInfo[];
  selection: readonly SeatId[];
  onChange?: (selection: SeatId[]) => void;
  onReject?: (id: SeatId, reason: SelectRejection) => void;
  max?: number;
  /** Driver's first name on his seat (the booked screen); "السايق" otherwise. */
  driverLabel?: string;
  legend?: boolean;
  /** Widest the car is drawn; it shrinks to fit narrower screens. */
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * The picture is always a light painting, so its markers use the light palette in both themes:
 * a dark-theme ink would turn cream and vanish on the cream leather.
 */
const P = themes.light;
const MARK = 40;

type Mark = { bg: string; border: string; fg: string; icon: IconName | null; dashed?: boolean; glow?: boolean };

function mark(state: SeatState, selected: boolean, blocked: boolean): Mark {
  if (selected) return { bg: P.accent, border: P.surface, fg: P.onAccent, icon: 'check' };
  if (state === 'free' && blocked) return { bg: 'rgba(31, 26, 20, 0.55)', border: P.onInverseMuted, fg: P.onInverse, icon: 'shield', dashed: true };
  switch (state) {
    case 'taken':
      return { bg: P.inverse, border: P.onInverseCaution, fg: P.onInverse, icon: 'user' };
    case 'walkup':
      return { bg: P.inverse, border: P.onInverseMuted, fg: P.onInverse, icon: 'garage' };
    case 'held':
      return { bg: 'rgba(31, 26, 20, 0.55)', border: P.onInverseCaution, fg: P.onInverse, icon: 'clock', dashed: true };
    default:
      return { bg: 'rgba(251, 246, 238, 0.55)', border: P.accent, fg: P.accentText, icon: null, glow: true };
  }
}

function SeatMark({
  seat,
  selected,
  interactive,
  at,
  onPress,
}: {
  seat: SeatInfo;
  selected: boolean;
  interactive: boolean;
  at: { left: number; top: number };
  onPress: () => void;
}) {
  const press = usePressScale(0.9);
  const pop = useSelectSpring(selected);
  const blocked = seat.state === 'free' && !!seat.blocked;
  const m = mark(seat.state, selected, blocked);
  const premium = seatPremium(seat);
  const canPress = interactive && (seat.state === 'free' || selected);
  const tag = selected ? t('seat.state_selected') : premium;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: at.left - MARK / 2, top: at.top - MARK / 2, width: MARK, alignItems: 'center' }}>
      <AnimatedPressable
        testID={`seat-${seat.id}`}
        accessibilityRole="checkbox"
        accessibilityLabel={seatLabel(seat, selected)}
        aria-checked={selected}
        aria-disabled={!canPress}
        disabled={!interactive}
        onPressIn={canPress ? press.onPressIn : undefined}
        onPressOut={press.onPressOut}
        onPress={onPress}
        // 40 px mark, 48 px target (rule: tap targets ≥ 44).
        hitSlop={4}
        style={press.style}
      >
        <Animated.View
          style={[
            {
              width: MARK,
              height: MARK,
              borderRadius: MARK / 2,
              backgroundColor: m.bg,
              borderWidth: selected ? 3 : m.glow ? 3 : 2,
              borderColor: m.border,
              borderStyle: m.dashed ? 'dashed' : 'solid',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: m.glow ? P.accent : P.shadow,
              shadowOpacity: m.glow ? 0.55 : selected ? 0.4 : 0.25,
              shadowRadius: m.glow ? 10 : 6,
              shadowOffset: { width: 0, height: m.glow ? 0 : 3 },
              elevation: selected ? 6 : 3,
            },
            pop,
          ]}
        >
          {m.icon ? <Icon name={m.icon} size={selected ? 22 : 18} color={m.fg} strokeWidth={selected ? 2.8 : 2} /> : null}
        </Animated.View>
      </AnimatedPressable>
      {tag ? (
        <View
          pointerEvents="none"
          style={{
            marginTop: 4,
            paddingHorizontal: 8,
            paddingVertical: 1,
            borderRadius: 999,
            backgroundColor: selected ? P.inverse : P.surface,
            shadowColor: P.shadow,
            shadowOpacity: 0.18,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          }}
        >
          <Text variant="caption" weight={700} tabular compact color={selected ? P.onInverseCaution : P.text} numberOfLines={1}>
            {tag}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function DriverMark({ at, label }: { at: { left: number; top: number }; label: string }) {
  const size = 34;
  return (
    <View
      accessible
      accessibilityLabel={label}
      pointerEvents="none"
      style={{ position: 'absolute', left: at.left - 40, top: at.top - size / 2, width: 80, alignItems: 'center' }}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: P.inverse,
          borderWidth: 2,
          borderColor: P.onInverseCaution,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8.5} stroke={P.onInverseCaution} strokeWidth={2.2} fill="none" />
          <Circle cx={12} cy={12} r={2.5} stroke={P.onInverseCaution} strokeWidth={2.2} fill="none" />
          <Path d="M12 14.5V20.5M9.6 11 3.8 9.5M14.4 11l5.8-1.5" stroke={P.onInverseCaution} strokeWidth={2.2} fill="none" strokeLinecap="round" />
        </Svg>
      </View>
      <View style={{ marginTop: 4, paddingHorizontal: 8, paddingVertical: 1, borderRadius: 999, backgroundColor: P.surface, maxWidth: 80 }}>
        <Text variant="caption" weight={700} compact color={P.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

/** The marks this car actually shows (free, yours, taken, then walk-up / hold / not-for-you only when present). */
function ArtLegend({ seats }: { seats: readonly SeatInfo[] }) {
  const theme = useTheme();
  const has = (f: (s: SeatInfo) => boolean) => seats.some(f);
  const items: { key: MessageKey; m: Mark }[] = [
    { key: 'seat.state_free', m: mark('free', false, false) },
    { key: 'seat.state_selected', m: mark('free', true, false) },
    { key: 'seat.state_taken', m: mark('taken', false, false) },
    ...(has((s) => s.state === 'walkup') ? [{ key: 'seat.state_walkup' as MessageKey, m: mark('walkup', false, false) }] : []),
    ...(has((s) => s.state === 'held') ? [{ key: 'seat.state_held' as MessageKey, m: mark('held', false, false) }] : []),
    ...(has((s) => s.state === 'free' && !!s.blocked) ? [{ key: 'seat.state_blocked' as MessageKey, m: mark('free', false, true) }] : []),
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: theme.space[4], rowGap: theme.space[1] }}>
      {items.map(({ key, m }) => (
        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              backgroundColor: m.glow ? 'transparent' : m.bg,
              borderWidth: 2,
              borderColor: m.glow ? m.border : m.bg,
              borderStyle: m.dashed ? 'dashed' : 'solid',
            }}
          />
          <Text variant="caption" color="textMuted">
            {t(key)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * The seat map drawn on the driver's own car (Ali, 2026-10-07): the car's painted top-down picture
 * with a round seat button on each seat. Free seats glow saffron, taken ones are ink with a person,
 * yours fills saffron with a check and «مقعدك». Same selection rules, rejections, haptics and
 * screen-reader labels as `SeatMap`; the screen falls back to `SeatMap` when the car has no picture.
 * Physical layout: it never mirrors in RTL.
 */
export function CarSeatArt({
  art,
  carName,
  layout,
  seats,
  selection,
  onChange,
  onReject,
  max = 1,
  driverLabel,
  legend = true,
  maxWidth = 340,
  style,
}: CarSeatArtProps) {
  const theme = useTheme();
  const [boxWidth, setBoxWidth] = useState(0);
  const width = Math.min(maxWidth, boxWidth || maxWidth);
  const height = width / art.aspect;
  const byId = new Map(seats.map((s) => [s.id, s]));
  const interactive = !!onChange;
  const pos = (p: { x: number; y: number }) => ({ left: (p.x / 100) * width, top: (p.y / 100) * height });

  const tap = (id: SeatId) => {
    const r = toggleSeat(seats, selection, id, max);
    if (r.rejected) {
      theme.haptic('error');
      onReject?.(id, r.rejected);
      return;
    }
    theme.haptic('selection');
    onChange?.(r.selection);
  };

  return (
    <View style={[{ gap: theme.space[3] }, style]} onLayout={(e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width)}>
      <View
        testID="car-seat-art"
        accessibilityLabel={carName ? `${carName}، ${t('seat.map_label')}` : t('seat.map_label')}
        style={{ alignSelf: 'center', width: '100%', alignItems: 'center', backgroundColor: art.background, borderRadius: theme.radius.lg, overflow: 'hidden' }}
      >
        <View style={{ width, height, direction: 'ltr' }}>
          <Image source={art.source} accessible={false} resizeMode="contain" style={{ width, height }} />
          <DriverMark at={pos(art.driver)} label={driverLabel ?? t('seat.driver')} />
          {seatIds(layout).map((id) => {
            const p = art.seats[id];
            if (!p) return null;
            const seat = byId.get(id) ?? { id, state: 'taken' as const };
            return <SeatMark key={id} seat={seat} selected={selection.includes(id)} interactive={interactive} at={pos(p)} onPress={() => tap(id)} />;
          })}
        </View>
      </View>
      {legend ? <ArtLegend seats={seats} /> : null}
    </View>
  );
}
