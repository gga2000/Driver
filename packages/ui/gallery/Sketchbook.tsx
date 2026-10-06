import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';
import { DISH_KINDS, DishDrawing, SCENE_NAMES, SKETCH, SketchScene, Text, useTheme, type SceneName, type SceneVehicle } from '../src';

/**
 * Every drawing of the Aziziyah sketchbook (joy J4): the dish set in its three looks at menu size, and
 * every scene. Open the gallery with `#sketchbook` to see only this page (the contact sheet).
 */

function Dish({ kind, look, size }: { kind: (typeof DISH_KINDS)[number]; look: number; size: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 14, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Rect x={0} y={0} width={200} height={200} fill={SKETCH.paper} />
        <DishDrawing kind={kind} look={look} />
      </Svg>
    </View>
  );
}

export function SketchbookDishes({ size = 96 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[4] }}>
      {DISH_KINDS.map((kind) => (
        <View key={kind} style={{ gap: 4, alignItems: 'center' }} testID={`sketch-dish-${kind}`}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[0, 1, 2].map((look) => (
              <Dish key={look} kind={kind} look={look} size={look === 0 ? size : Math.round(size * 0.66)} />
            ))}
          </View>
          <Text variant="caption" color="textMuted">
            {kind}
          </Text>
        </View>
      ))}
    </View>
  );
}

const VEHICLES: SceneVehicle[] = ['minibus', 'tuktuk', 'car'];

type Specimen = { name: SceneName; vehicle?: SceneVehicle };
const SPECIMENS: Specimen[] = SCENE_NAMES.flatMap((name): Specimen[] => (name === 'safe_arrival' ? VEHICLES.map((vehicle) => ({ name, vehicle })) : [{ name }]));

export function SketchbookScenes({ width = 320 }: { width?: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[5] }}>
      {SPECIMENS.map(({ name, vehicle }) => (
        <View key={`${name}-${vehicle ?? ''}`} style={{ width, gap: 4 }} testID={`sketch-scene-${name}${vehicle ? `-${vehicle}` : ''}`}>
          <SketchScene name={name} vehicle={vehicle} />
          <Text variant="caption" color="textMuted" align="center">
            {vehicle ? `${name} · ${vehicle}` : name}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** The contact sheet: dishes, then scenes, on paper. */
export function SketchbookPage({ dishSize = 96 }: { dishSize?: number }) {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.space[6], gap: theme.space[8], backgroundColor: SKETCH.paper }}>
      <Text variant="heading">دفتر رسم العزيزية · الأكلات</Text>
      <SketchbookDishes size={dishSize} />
      <Text variant="heading">المشاهد</Text>
      <SketchbookScenes />
    </View>
  );
}
