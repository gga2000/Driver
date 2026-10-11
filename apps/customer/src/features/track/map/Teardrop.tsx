import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/** Size of the kitchen and door pins on the 3D maps. */
export const PIN = 40;

/** A map pin: a rounded square turned 45°, tip down, with a soft halo. */
export function Teardrop({ fill, halo, children }: { fill: string; halo: string; children: ReactNode }) {
  const inner = PIN - 6;
  return (
    <View style={{ width: PIN, height: PIN + 4, alignItems: 'center' }}>
      <View
        style={{
          width: inner,
          height: inner,
          marginTop: 3,
          backgroundColor: fill,
          borderRadius: inner / 2,
          borderBottomRightRadius: 3,
          transform: [{ rotate: '45deg' }],
          boxShadow: `0 0 0 4px ${halo}, 0 3px 8px rgba(40,24,8,0.3)`,
        }}
      />
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', paddingBottom: 6 }]}>{children}</View>
    </View>
  );
}
