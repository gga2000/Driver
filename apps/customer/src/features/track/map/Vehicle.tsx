import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import type { VehicleClass } from '@driver/contracts';

/** Drawn from above, pointing north; the marker rotates the whole drawing to the heading. */
export type VehicleKind = 'bike' | 'tuktuk' | 'car';

export function vehicleKind(v: VehicleClass | null | undefined): VehicleKind {
  return v === 'bike' ? 'bike' : v === 'tuktuk' ? 'tuktuk' : 'car';
}

export const VEHICLE_SIZE = 44;

/**
 * Our own top-down vehicles (maps program SP5a, x1): a courier motorbike with its delivery box, a
 * tuktuk (narrow nose, wide cabin), a car. Brand body colour, ink outline, a soft ground shadow.
 * `muted` greys it out when his signal is lost.
 */
export function Vehicle({ kind, body, ink, glass, shadow, muted }: { kind: VehicleKind; body: string; ink: string; glass: string; shadow: string; muted: boolean }) {
  const fill = muted ? glass : body;
  const s = VEHICLE_SIZE;
  return (
    <Svg width={s} height={s} viewBox="0 0 44 44">
      <Ellipse cx={22} cy={24} rx={kind === 'bike' ? 8 : 12} ry={17} fill={shadow} opacity={0.18} />
      {kind === 'bike' ? (
        <>
          {/* wheels */}
          <Rect x={20} y={4} width={4} height={8} rx={2} fill={ink} />
          <Rect x={20} y={32} width={4} height={8} rx={2} fill={ink} />
          {/* body and handlebar */}
          <Rect x={18} y={9} width={8} height={24} rx={4} fill={ink} />
          <Rect x={13} y={11} width={18} height={3} rx={1.5} fill={ink} />
          {/* delivery box behind the rider */}
          <Rect x={13} y={24} width={18} height={14} rx={2.5} fill={fill} stroke={ink} strokeWidth={1.6} />
          <Path d="M17 31h10" stroke={ink} strokeWidth={1.4} strokeLinecap="round" opacity={0.5} />
          {/* rider */}
          <Circle cx={22} cy={18} r={5} fill={glass} stroke={ink} strokeWidth={1.6} />
        </>
      ) : kind === 'tuktuk' ? (
        <>
          <Rect x={19.5} y={3} width={5} height={7} rx={2} fill={ink} />
          <Rect x={8} y={29} width={5} height={9} rx={2} fill={ink} />
          <Rect x={31} y={29} width={5} height={9} rx={2} fill={ink} />
          <Path d="M17 7h10l7 12v16a3 3 0 0 1-3 3H13a3 3 0 0 1-3-3V19z" fill={fill} stroke={ink} strokeWidth={1.6} strokeLinejoin="round" />
          {/* canopy */}
          <Rect x={13} y={18} width={18} height={17} rx={3} fill={glass} stroke={ink} strokeWidth={1.4} />
          <Path d="M17 11h10" stroke={ink} strokeWidth={1.4} strokeLinecap="round" />
        </>
      ) : (
        <>
          <Rect x={11} y={8} width={4} height={7} rx={1.5} fill={ink} />
          <Rect x={29} y={8} width={4} height={7} rx={1.5} fill={ink} />
          <Rect x={11} y={29} width={4} height={7} rx={1.5} fill={ink} />
          <Rect x={29} y={29} width={4} height={7} rx={1.5} fill={ink} />
          <Rect x={13} y={4} width={18} height={36} rx={7} fill={fill} stroke={ink} strokeWidth={1.6} />
          {/* windscreen, roof, rear window */}
          <Path d="M16 13.5c3.6-1.6 8.4-1.6 12 0l-1 4.5c-3-1-7-1-10 0z" fill={glass} stroke={ink} strokeWidth={1.2} strokeLinejoin="round" />
          <Rect x={16.5} y={19} width={11} height={11} rx={2.5} fill={fill} stroke={ink} strokeWidth={1.2} opacity={0.9} />
          <Path d="M17 34c3 1 7 1 10 0l-.8-3c-2.8.6-5.6.6-8.4 0z" fill={glass} stroke={ink} strokeWidth={1.2} strokeLinejoin="round" />
        </>
      )}
    </Svg>
  );
}
