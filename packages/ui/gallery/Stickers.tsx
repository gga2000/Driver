import { View } from 'react-native';
import Svg from 'react-native-svg';
import { t } from '@driver/i18n';
import { DishDrawing } from '../src/dishes';
import { SketchScene, STICKERS, Text, useTheme } from '../src';

/**
 * «ستيكرات درايفر» (joy g7): each sticker's drawing alone on a transparent ground (`#stickers`), with
 * its line under it for a look. `apps/customer/scripts/stickers-export.mjs` reads the drawings
 * (`sticker-art-<id>`) from here and composes the 512×512 WebP files.
 */
export function StickersPage() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[6], padding: theme.space[6] }}>
      {STICKERS.map((s) => (
        <View key={s.id} style={{ width: 320, gap: theme.space[2], alignItems: 'center' }}>
          <View testID={`sticker-art-${s.id}`} style={{ width: 320, height: 'dish' in s.art ? 320 : 200 }}>
            {'dish' in s.art ? (
              <Svg width="100%" height="100%" viewBox="0 0 200 200">
                <DishDrawing kind={s.art.dish} look={0} window={false} />
              </Svg>
            ) : (
              <SketchScene name={s.art.scene} vehicle={s.art.vehicle} animate={false} />
            )}
          </View>
          <Text variant="voice" align="center">
            {t(`sticker.line.${s.id}` as Parameters<typeof t>[0])}
          </Text>
        </View>
      ))}
    </View>
  );
}
