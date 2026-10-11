import { useState } from 'react';
import { View, type ImageStyle, type StyleProp } from 'react-native';
import { PhotoImage, useTheme } from '@driver/ui';
import { apiPhoto } from '@/lib/photo';

/**
 * A shop's photo from the API (`/media/...`), cached once seen. Until it arrives, or if it can't, the
 * box keeps a warm sunken fill, so a card never shows a broken picture.
 */
export function ProducePhoto({ uri, label, style }: { uri: string; label: string; style?: StyleProp<ImageStyle> }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  const src = apiPhoto(uri);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[{ backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }, style as object]}>
      {src && !failed ? <PhotoImage uri={src} onError={() => setFailed(true)} style={{ width: '100%', height: '100%' }} /> : null}
    </View>
  );
}
