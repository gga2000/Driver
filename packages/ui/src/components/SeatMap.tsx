import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { t, type MessageKey } from '@driver/i18n';
import { formatAmount } from '../format';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { SEAT_ROWS, toggleSeat, type SeatId, type SeatInfo, type SeatLayout, type SeatState, type SelectRejection } from '../logic/seats';
import { AnimatedPressable, usePressScale, useSelectSpring } from '../motion/motion';
import { useTheme, type Theme } from '../theme/ThemeProvider';
import { Text } from './Text';

export interface SeatMapProps {
  layout: SeatLayout;
  seats: readonly SeatInfo[];
  selection: readonly SeatId[];
  onChange?: (selection: SeatId[]) => void;
  /** Tap on a seat that can't be booked (drives a toast: "أحد حجز المقعد قبلك"). */
  onReject?: (id: SeatId, reason: SelectRejection) => void;
  /** How many seats this booking may hold (1 for a single rider). */
  max?: number;
  /** Read-only board (garage list): no presses, smaller cells. */
  compact?: boolean;
  legend?: boolean;
  style?: StyleProp<ViewStyle>;
}

const STATE_KEY: Record<SeatState | 'selected' | 'blocked', MessageKey> = {
  free: 'seat.state_free',
  blocked: 'seat.state_blocked',
  taken: 'seat.state_taken',
  walkup: 'seat.state_walkup',
  held: 'seat.state_held',
  selected: 'seat.state_selected',
};

/** "+2,000" on a free, open seat with a premium (the front seat); null otherwise. */
export function seatPremium(seat: SeatInfo): string | null {
  return seat.premium && seat.state === 'free' && !seat.blocked ? `+${formatAmount(seat.premium)}` : null;
}

/** What a screen reader says for a seat: its place, its state for this rider, and its premium. */
export function seatLabel(seat: SeatInfo, selected: boolean): string {
  const blocked = seat.state === 'free' && !!seat.blocked;
  const premium = seatPremium(seat);
  return [
    t(`seat.${seat.id}` as MessageKey),
    t(selected ? STATE_KEY.selected : blocked ? STATE_KEY.blocked : STATE_KEY[seat.state]),
    premium ? `${premium} ${t('quote.currency')}` : null,
  ]
    .filter(Boolean)
    .join('، ');
}

type Look = { bg: string; border: string; dashed?: boolean; fg: string; icon?: IconName };

function look(theme: Theme, state: SeatState, selected: boolean, front: boolean, blocked = false): Look {
  const c = theme.colors;
  if (selected) return { bg: c.accent, border: c.accent, fg: c.onAccent, icon: 'check' };
  // Free but not for this viewer (adjacency / family-only): quiet, locked, still readable.
  if (state === 'free' && blocked) return { bg: c.surfaceSunken, border: c.borderStrong, dashed: true, fg: c.textMuted, icon: 'shield' };
  switch (state) {
    case 'taken':
      return { bg: c.seatTaken, border: c.seatTaken, fg: c.textMuted, icon: 'user' };
    case 'walkup':
      return { bg: c.infoTint, border: c.info, fg: c.infoText, icon: 'garage' };
    case 'held':
      return { bg: c.warningTint, border: c.warning, dashed: true, fg: c.warningText, icon: 'clock' };
    default:
      return front
        ? { bg: c.accentTint, border: c.accent, fg: c.accentText, icon: 'seat' }
        : { bg: c.surface, border: c.borderStrong, fg: c.textMuted, icon: 'seat' };
  }
}

function Seat({
  seat,
  selected,
  size,
  interactive,
  onPress,
}: {
  seat: SeatInfo;
  selected: boolean;
  size: { w: number; h: number };
  interactive: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const press = usePressScale(0.92);
  const pop = useSelectSpring(selected);
  const front = seat.id === 'front';
  const blocked = seat.state === 'free' && !!seat.blocked;
  const l = look(theme, seat.state, selected, front, blocked);
  const premium = seatPremium(seat);
  const label = seatLabel(seat, selected);
  // Blocked seats stay pressable so the screen can say why (onReject 'blocked').
  const canPress = interactive && (seat.state === 'free' || selected);

  return (
    <AnimatedPressable
      testID={`seat-${seat.id}`}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      aria-checked={selected}
      aria-disabled={!canPress}
      disabled={!interactive}
      onPressIn={canPress ? press.onPressIn : undefined}
      onPressOut={press.onPressOut}
      onPress={onPress}
      style={press.style}
    >
      <Animated.View
        style={[
          {
            width: size.w,
            height: size.h,
            borderRadius: theme.radius.seat,
            borderTopStartRadius: theme.radius.seat + 6,
            borderTopEndRadius: theme.radius.seat + 6,
            backgroundColor: l.bg,
            borderWidth: 1.5,
            borderStyle: l.dashed ? 'dashed' : 'solid',
            borderColor: l.border,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 2,
          },
          pop,
        ]}
      >
        {l.icon ? <Icon name={l.icon} size={size.w < 48 ? 18 : 20} color={l.fg} strokeWidth={selected ? 2.4 : 1.9} /> : null}
        {premium && !selected && size.w >= 48 ? (
          <Text variant="caption" weight={700} color={l.fg} tabular compact style={{ lineHeight: 16 }}>
            {premium}
          </Text>
        ) : null}
      </Animated.View>
    </AnimatedPressable>
  );
}

function CarBody({ width, height, theme }: { width: number; height: number; theme: Theme }) {
  const c = theme.colors;
  const r = Math.min(44, width * 0.22);
  return (
    <Svg width={width} height={height} style={{ position: 'absolute', top: 0, left: 0 }}>
      {/* Mirrors */}
      <Rect x={0} y={58} width={10} height={16} rx={4} fill={c.border} />
      <Rect x={width - 10} y={58} width={10} height={16} rx={4} fill={c.border} />
      {/* Body */}
      <Rect x={6} y={1} width={width - 12} height={height - 2} rx={r} fill={c.surfaceSunken} stroke={c.border} strokeWidth={1.5} />
      {/* Windscreen and rear window as soft arcs */}
      <Path
        d={`M ${22} ${40} Q ${width / 2} ${18} ${width - 22} ${40}`}
        stroke={c.borderStrong}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
      <Path
        d={`M ${28} ${height - 22} Q ${width / 2} ${height - 8} ${width - 28} ${height - 22}`}
        stroke={c.borderStrong}
        strokeWidth={2}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Top-down car seat map (garage board, booking). Physical layout: front at the top, driver on
 * the left; it does not mirror in RTL. Front seat carries the accent; taken seats grey out;
 * walk-ups (sold at the garage) and 10-minute holds are marked.
 */
export function SeatMap({ layout, seats, selection, onChange, onReject, max = 1, compact = false, legend = true, style }: SeatMapProps) {
  const theme = useTheme();
  const rows = SEAT_ROWS[layout];
  const size = compact ? { w: 38, h: 40 } : { w: 54, h: 58 };
  const gap = compact ? 6 : 10;
  const padX = compact ? 18 : 26;
  const padTop = compact ? 34 : 54;
  const padBottom = compact ? 22 : 34;
  const width = size.w * 3 + gap * 2 + padX * 2;
  const height = padTop + rows.length * size.h + (rows.length - 1) * gap + padBottom;
  const byId = new Map(seats.map((s) => [s.id, s]));
  const interactive = !compact && !!onChange;

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
    <View style={[{ gap: theme.space[3], alignItems: 'center' }, style]}>
      <View
        accessibilityLabel={t('seat.map_label')}
        style={{ width, height, direction: 'ltr' }}
      >
        <CarBody width={width} height={height} theme={theme} />
        <View style={{ position: 'absolute', top: padTop, left: padX, gap, flexDirection: 'column' }}>
          {rows.map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap }}>
              {row.map((cell, ci) => {
                if (cell === null) return <View key={ci} style={{ width: size.w, height: size.h }} />;
                if (cell === 'driver') {
                  return (
                    <View
                      key={ci}
                      accessible
                      accessibilityLabel={t('seat.driver')}
                      style={{
                        width: size.w,
                        height: size.h,
                        borderRadius: theme.radius.seat,
                        borderTopStartRadius: theme.radius.seat + 6,
                        borderTopEndRadius: theme.radius.seat + 6,
                        backgroundColor: theme.colors.surfaceSunken,
                        borderWidth: 1.5,
                        borderColor: theme.colors.border,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {/* Steering wheel */}
                      <Svg width={compact ? 18 : 22} height={compact ? 18 : 22} viewBox="0 0 24 24">
                        <Path
                          d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 11h17M12 14v6.5M9 11a3 3 0 0 0 6 0"
                          stroke={theme.colors.textMuted}
                          strokeWidth={1.8}
                          fill="none"
                          strokeLinecap="round"
                        />
                      </Svg>
                    </View>
                  );
                }
                const seat = byId.get(cell) ?? { id: cell, state: 'taken' as const };
                return (
                  <Seat
                    key={ci}
                    seat={seat}
                    selected={selection.includes(cell)}
                    size={size}
                    interactive={interactive}
                    onPress={() => tap(cell)}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>
      {legend && !compact ? <SeatLegend blocked={seats.some((s) => s.blocked && s.state === 'free')} /> : null}
    </View>
  );
}

export function SeatLegend({ blocked = false }: { /** Add the "not for you" swatch (booking with a travelling-as declaration). */ blocked?: boolean } = {}) {
  const theme = useTheme();
  const items: { key: MessageKey; look: Look }[] = [
    { key: 'seat.state_free', look: look(theme, 'free', false, false) },
    { key: 'seat.front', look: look(theme, 'free', false, true) },
    { key: 'seat.state_taken', look: look(theme, 'taken', false, false) },
    { key: 'seat.state_walkup', look: look(theme, 'walkup', false, false) },
    { key: 'seat.state_held', look: look(theme, 'held', false, false) },
    ...(blocked ? [{ key: 'seat.state_blocked' as MessageKey, look: look(theme, 'free', false, false, true) }] : []),
  ];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: theme.space[4], rowGap: theme.space[1] }}>
      {items.map((i) => (
        <View key={i.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              backgroundColor: i.look.bg,
              borderWidth: 1.5,
              borderColor: i.look.border,
              borderStyle: i.look.dashed ? 'dashed' : 'solid',
            }}
          />
          <Text variant="caption" color="textMuted">
            {t(i.key)}
          </Text>
        </View>
      ))}
    </View>
  );
}
