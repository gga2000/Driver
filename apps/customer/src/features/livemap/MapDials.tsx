import { Pressable, View } from 'react-native';
import { Text, useTheme, withAlpha } from '@driver/ui';
import { useT } from '@/lib/i18n';

const SIZE = 44;
const SHADOW = '0 2px 6px rgba(40,24,8,0.28)';

/** Tilted past this many degrees the map counts as «3D»; the button then lays it flat. */
export const TILTED_FROM = 20;
/** The tilt the «3D» button gives back (the town's usual look). */
export const TILT_3D = 55;

export interface MapDialsProps {
  /** Map bearing in degrees (0 = north up). */
  bearing: number;
  /** Map pitch in degrees (0 = flat). */
  pitch: number;
  onNorth: () => void;
  onTilt: () => void;
  /** Distance from the top of the map (under the screen's header). */
  top: number;
}

/**
 * Two round buttons on the live map so turning and tilting can be found without a gesture:
 * a compass whose needle always points to the north (tap: turn the map north up), and «3D / 2D»
 * (tap: tilt it up, or lay it flat). Both stand still on the screen; the map moves under them.
 */
export function MapDials({ bearing, pitch, onNorth, onTilt, top }: MapDialsProps) {
  const theme = useTheme();
  const t = useT();
  const tilted = pitch > TILTED_FROM;
  const disc = { width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: withAlpha(theme.colors.surface, 0.96), boxShadow: SHADOW, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, top, gap: 10, zIndex: 20 }} testID="live-dials">
      <Pressable accessibilityRole="button" accessibilityLabel={t('live_map.compass')} onPress={onNorth} style={disc} testID="live-compass">
        <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: `${-bearing}deg` }] }}>
          {/* The needle: north half in the accent, south half in grey. */}
          <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 13, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: theme.colors.accent }} />
          <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 13, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: theme.colors.border }} />
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={tilted ? t('live_map.flat') : t('live_map.tilt')} onPress={onTilt} style={disc} testID="live-tilt">
        <Text variant="caption" weight={700} tabular>
          {tilted ? '2D' : '3D'}
        </Text>
      </Pressable>
    </View>
  );
}
