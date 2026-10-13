import { View } from 'react-native';
import { useTheme } from '@driver/ui';

/**
 * The fixed pin over the map's centre (Ali's pin rule: saffron pin in a cream ring, on the day map). The
 * map moves under it; its point is the bottom tip, at the centre of the box.
 */
export function DoorPin() {
  const theme = useTheme();
  const { css: _css, ...lift } = theme.elevation[2];
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ alignItems: 'center', transform: [{ translateY: -27 }] }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center', ...lift }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.bg }} />
          </View>
        </View>
        <View style={{ width: 3, height: 10, borderRadius: 2, backgroundColor: theme.colors.text }} />
      </View>
      <View style={{ position: 'absolute', width: 10, height: 4, borderRadius: 5, backgroundColor: theme.colors.text, opacity: 0.25 }} />
    </View>
  );
}
