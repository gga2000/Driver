import type { Ref } from 'react';
import { View } from 'react-native';
import Svg from 'react-native-svg';
import { SKETCH, SketchScene, Text, useTheme } from '@driver/ui';
import { DishDrawing } from '@driver/ui/dishes';
import { useT } from '@/lib/i18n';
import { CARD } from './layout';
import type { ShareCardModel } from './share-card';

/**
 * The share card itself (joy l5): sketchbook paper, the dish in its arch window (or the arrival
 * scene), «بالعافية» in Marhey, the warm line, and «درايفر · العزيزية». Drawn at the artboard's
 * logical size; `scale` shrinks it for the preview. The phone captures this view; the web redraws it
 * on a canvas from the same model and layout (`render.ts`).
 */
export function ShareCardView({ model, scale = 1, viewRef }: { model: ShareCardModel; scale?: number; viewRef?: Ref<View> }) {
  const theme = useTheme();
  const t = useT();
  const s = (n: number) => n * scale;
  return (
    <View
      ref={viewRef}
      collapsable={false}
      testID="sharecard"
      accessible
      accessibilityLabel={[t(model.head.key, model.head.params), model.sub ? t(model.sub.key, model.sub.params) : ''].join('، ')}
      style={{ width: s(CARD.w), height: s(CARD.h), backgroundColor: SKETCH.paper, borderRadius: s(18), overflow: 'hidden' }}
    >
      <View testID="sharecard-art" style={'dish' in model.art ? { position: 'absolute', top: s(CARD.dishTop), left: s((CARD.w - CARD.dishSize) / 2), width: s(CARD.dishSize), height: s(CARD.dishSize) } : { position: 'absolute', top: s(CARD.sceneTop), left: s((CARD.w - CARD.sceneW) / 2), width: s(CARD.sceneW), height: s(CARD.sceneH) }}>
        {'dish' in model.art ? (
          <Svg width="100%" height="100%" viewBox="0 0 200 200">
            <DishDrawing kind={model.art.dish} look={0} />
          </Svg>
        ) : (
          <SketchScene name={model.art.scene} vehicle={model.art.vehicle} animate={false} style={{ width: '100%' }} />
        )}
      </View>
      <View style={{ position: 'absolute', top: s(CARD.headY - CARD.headSize), left: s(CARD.pad), right: s(CARD.pad), alignItems: 'center' }}>
        <Text face="voice" align="center" numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: s(CARD.headSize), lineHeight: s(CARD.headSize * 1.5), color: SKETCH.line }}>
          {t(model.head.key, model.head.params)}
        </Text>
      </View>
      {model.sub ? (
        <View style={{ position: 'absolute', top: s(CARD.subY - CARD.subSize * 1.2), left: s(CARD.pad), right: s(CARD.pad), alignItems: 'center' }}>
          <Text face="display" align="center" numberOfLines={2} style={{ fontSize: s(CARD.subSize), lineHeight: s(CARD.subSize * 1.6), color: SKETCH.line }}>
            {t(model.sub.key, model.sub.params)}
          </Text>
        </View>
      ) : null}
      <View style={{ position: 'absolute', top: s(CARD.ruleY), left: s(CARD.w / 2 - 24), width: s(48), height: Math.max(1, s(3)), borderRadius: s(2), backgroundColor: theme.colors.accent }} />
      <View style={{ position: 'absolute', top: s(CARD.brandY - CARD.brandSize * 1.2), left: s(CARD.pad), right: s(CARD.pad), alignItems: 'center' }}>
        <Text face="voice" align="center" style={{ fontSize: s(CARD.brandSize), lineHeight: s(CARD.brandSize * 1.7), color: SKETCH.tea }}>
          {t(model.brand.key)}
        </Text>
      </View>
    </View>
  );
}
