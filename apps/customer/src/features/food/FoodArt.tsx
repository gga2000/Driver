import { memo } from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useLiteMode } from '@driver/ui';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { art } from '@driver/design-tokens';
import { ART_LOOKS, type Motif } from './food-art';

export { artOf, dishArt, motifForDish, motifForKitchen, type DishArt, type Motif } from './food-art';

/**
 * Illustrated placeholder for kitchens and dishes without a photo yet (every launch merchant today):
 * one drawing per kind of dish (`food-art.ts` picks it from the dish, never the kitchen), in fixed
 * pigments (`art` tokens) so the food looks the same by day and by night. Each dish has one of a few
 * looks — a slight tilt, its own plate tint, garnish or not — and a menu never puts the same drawing
 * on two rows in a row. A merchant photo, when uploaded, replaces it.
 */

interface Look {
  plate: string;
  tilt: number;
  garnish: boolean;
}

const TILTS = [-6, 0, 6] as const;

function lookOf(look: number): Look {
  const i = ((look % ART_LOOKS) + ART_LOOKS) % ART_LOOKS;
  return { plate: art.plateTints[i] ?? art.plate, tilt: TILTS[i] ?? 0, garnish: i !== 1 };
}

const P = art;

function Plate({ l, rx = 84, ry = 48, cy = 120 }: { l: Look; rx?: number; ry?: number; cy?: number }) {
  return <Ellipse cx={100} cy={cy} rx={rx} ry={ry} fill={l.plate} stroke={P.rim} strokeWidth={3} />;
}

function Herbs({ l, x = 52, y = 146 }: { l: Look; x?: number; y?: number }) {
  if (!l.garnish) return null;
  return (
    <G>
      <Circle cx={x} cy={y} r={6} fill={P.herb} />
      <Circle cx={x + 12} cy={y + 6} r={5} fill={P.herb} opacity={0.8} />
    </G>
  );
}

function Steam({ x = 150, y = 70 }: { x?: number; y?: number }) {
  return <Path d={`M${x} ${y} q8 -10 0 -20 q-8 -10 0 -20`} stroke={P.steam} strokeWidth={3} fill="none" strokeLinecap="round" />;
}

function Skewer({ y, cubes }: { y: number; cubes: readonly string[] }) {
  return (
    <G>
      <Line x1={22} y1={y + 9} x2={182} y2={y + 9} stroke={P.metal} strokeWidth={3} strokeLinecap="round" />
      {cubes.map((c, k) => (
        <Rect key={k} x={42 + k * 24} y={y} width={20} height={18} rx={7} fill={c} />
      ))}
    </G>
  );
}

/** The motif drawn in a 200 × 200 box centred on (100, 100). */
function MotifShape({ motif, l }: { motif: Motif; l: Look }) {
  switch (motif) {
    case 'kebab':
      return (
        <G>
          <Plate l={l} />
          <G transform="rotate(-14 100 100)">
            <Skewer y={82} cubes={[P.meat, P.char, P.meat, P.char, P.meat]} />
            <Skewer y={106} cubes={[P.char, P.meat, P.tomato, P.meat, P.char]} />
          </G>
          <Steam />
          <Herbs l={l} />
        </G>
      );
    case 'tikka':
      return (
        <G>
          <Plate l={l} />
          <G transform="rotate(10 100 100)">
            <Line x1={20} y1={104} x2={184} y2={104} stroke={P.metal} strokeWidth={3} strokeLinecap="round" />
            {[P.meat, P.onion, P.meat, P.tomato, P.meat, P.onion].map((c, k) => (
              <Rect key={k} x={34 + k * 23} y={90} width={21} height={28} rx={5} fill={c} stroke={P.char} strokeWidth={c === P.meat ? 2 : 0} />
            ))}
          </G>
          <Herbs l={l} x={140} y={150} />
        </G>
      );
    case 'liver':
      return (
        <G>
          <Plate l={l} />
          {[
            [64, 108],
            [86, 98],
            [110, 104],
            [132, 112],
            [76, 128],
            [100, 124],
            [122, 132],
          ].map(([x, y], i) => (
            <Rect key={i} x={x} y={y} width={18} height={14} rx={5} fill={i % 2 ? P.char : P.meat} transform={`rotate(${(i * 23) % 40 - 20} ${x! + 9} ${y! + 7})`} />
          ))}
          <Ellipse cx={146} cy={96} rx={14} ry={7} fill="none" stroke={P.onion} strokeWidth={4} />
          <Herbs l={l} x={58} y={140} />
        </G>
      );
    case 'chicken':
      return (
        <G>
          <Plate l={l} />
          <Ellipse cx={92} cy={110} rx={46} ry={30} fill={P.chicken} stroke={P.meat} strokeWidth={3} />
          <Path d="M128 110 q22 -6 30 -24" stroke={P.chicken} strokeWidth={14} strokeLinecap="round" fill="none" />
          <Circle cx={160} cy={82} r={8} fill={P.laban} stroke={P.rim} strokeWidth={2} />
          <Path d="M70 104 q20 -12 40 0" stroke={P.char} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.6} />
          <Circle cx={62} cy={142} r={7} fill={P.tomato} />
          <Herbs l={l} x={118} y={146} />
        </G>
      );
    case 'wrap':
      return (
        <G>
          <Ellipse cx={100} cy={160} rx={70} ry={10} fill={P.rim} />
          <G transform="rotate(-24 100 100)">
            <Rect x={30} y={78} width={140} height={46} rx={23} fill={P.bread} stroke={P.char} strokeWidth={3} />
            <Path d="M60 80 L60 122 M92 80 L92 122 M124 80 L124 122" stroke={P.char} strokeWidth={2} opacity={0.35} />
            <Ellipse cx={166} cy={101} rx={10} ry={20} fill={P.meat} />
            {l.garnish ? <Circle cx={168} cy={90} r={5} fill={P.herb} /> : null}
            <Circle cx={170} cy={110} r={4} fill={P.tomato} />
          </G>
        </G>
      );
    case 'shawarma':
      return (
        <G>
          <Ellipse cx={100} cy={170} rx={56} ry={12} fill={P.rim} />
          <Line x1={100} y1={18} x2={100} y2={172} stroke={P.metal} strokeWidth={4} strokeLinecap="round" />
          <Path d="M66 40 L134 40 L122 160 L78 160 Z" fill={l.garnish ? P.meat : P.chicken} />
          {[58, 80, 102, 124, 146].map((y) => (
            <Path key={y} d={`M${68 + (y - 40) * 0.1} ${y} L${132 - (y - 40) * 0.1} ${y}`} stroke={P.char} strokeWidth={5} strokeLinecap="round" opacity={0.75} />
          ))}
          <Path d="M66 40 L134 40" stroke={P.char} strokeWidth={6} strokeLinecap="round" />
        </G>
      );
    case 'falafel':
      return (
        <G>
          <Plate l={l} rx={80} ry={46} cy={118} />
          {[
            [70, 108],
            [100, 100],
            [130, 108],
            [86, 128],
            [116, 128],
          ].map(([x, y], i) => (
            <G key={i}>
              <Circle cx={x} cy={y} r={15} fill={P.meat} />
              <Circle cx={x! - 4} cy={y! - 4} r={4} fill={P.herb} opacity={0.7} />
            </G>
          ))}
        </G>
      );
    case 'rice':
      return (
        <G>
          <Plate l={l} />
          <Path d="M40 118 Q86 60 132 118 Z" fill={P.rice} stroke={P.rim} strokeWidth={2} />
          {[60, 76, 92, 108].map((x) => (
            <Ellipse key={x} cx={x} cy={104 - ((x * 7) % 9)} rx={4} ry={2} fill={P.laban} />
          ))}
          <Ellipse cx={150} cy={118} rx={28} ry={16} fill={l.plate} stroke={P.rim} strokeWidth={3} />
          <Ellipse cx={150} cy={116} rx={22} ry={11} fill={P.tea} />
          <Steam x={150} y={92} />
        </G>
      );
    case 'soup':
      return (
        <G>
          <Ellipse cx={100} cy={160} rx={70} ry={12} fill={P.rim} />
          <Path d="M36 96 Q100 196 164 96 Z" fill={l.plate} stroke={P.rim} strokeWidth={3} />
          <Ellipse cx={100} cy={96} rx={64} ry={16} fill={P.juice} stroke={P.rim} strokeWidth={3} />
          {l.garnish ? <Path d="M138 90 l14 -6 l-4 12 z" fill={P.onion} stroke={P.herb} strokeWidth={2} /> : null}
          <Steam x={88} y={70} />
          <Steam x={112} y={66} />
        </G>
      );
    case 'salad':
      return (
        <G>
          <Path d="M30 104 Q100 190 170 104 Z" fill={l.plate} stroke={P.rim} strokeWidth={3} />
          <Circle cx={74} cy={98} r={14} fill={P.herb} />
          <Circle cx={100} cy={92} r={16} fill={P.herb} opacity={0.85} />
          <Circle cx={126} cy={98} r={14} fill={P.tomato} />
          <Circle cx={100} cy={106} r={10} fill={P.onion} />
        </G>
      );
    case 'pickles':
      return (
        <G>
          <Ellipse cx={100} cy={170} rx={48} ry={8} fill={P.rim} />
          <Rect x={62} y={52} width={76} height={118} rx={18} fill={P.laban} stroke={P.metal} strokeWidth={3} opacity={0.9} />
          <Rect x={68} y={40} width={64} height={16} rx={5} fill={P.tomato} />
          <Circle cx={86} cy={96} r={12} fill={P.herb} />
          <Circle cx={112} cy={110} r={11} fill={P.tomato} opacity={0.85} />
          <Circle cx={92} cy={132} r={12} fill={P.onion} stroke={P.juice} strokeWidth={2} />
          <Circle cx={116} cy={146} r={9} fill={P.herb} opacity={0.8} />
        </G>
      );
    case 'bread':
      return l.garnish ? (
        <G>
          <Ellipse cx={100} cy={112} rx={84} ry={52} fill={P.meat} opacity={0.3} />
          <Ellipse cx={100} cy={106} rx={76} ry={44} fill={P.bread} stroke={P.char} strokeWidth={3} />
          {[
            [76, 96],
            [104, 88],
            [126, 108],
            [92, 120],
            [116, 126],
          ].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={4} fill={P.char} opacity={0.35} />
          ))}
        </G>
      ) : (
        <G>
          <Ellipse cx={100} cy={150} rx={70} ry={10} fill={P.rim} />
          <Path d="M30 110 L100 70 L170 110 L100 146 Z" fill={P.bread} stroke={P.char} strokeWidth={3} strokeLinejoin="round" />
          <Path d="M70 110 L130 110" stroke={P.char} strokeWidth={3} opacity={0.4} strokeLinecap="round" />
        </G>
      );
    case 'sweet':
      return (
        <G>
          <Plate l={l} rx={80} ry={44} />
          {[0, 1, 2].map((r) =>
            [0, 1, 2].map((c) => <Rect key={`${r}${c}`} x={58 + c * 28 + r * 4} y={92 + r * 14} width={24} height={12} rx={3} fill={(r + c) % 2 ? P.juice : P.bread} stroke={P.meat} strokeWidth={1.5} />),
          )}
          {l.garnish ? <Circle cx={150} cy={110} r={5} fill={P.herb} /> : null}
        </G>
      );
    case 'tea':
      return (
        <G>
          <Ellipse cx={100} cy={160} rx={62} ry={14} fill={l.plate} stroke={P.rim} strokeWidth={3} />
          <Path d="M72 62 Q66 100 82 112 Q66 126 74 156 L126 156 Q134 126 118 112 Q134 100 128 62 Z" fill={P.laban} stroke={P.metal} strokeWidth={3} />
          <Path d="M76 84 Q72 102 84 112 Q71 125 78 152 L122 152 Q129 125 116 112 Q128 102 124 84 Z" fill={P.tea} />
          <Steam x={100} y={52} />
          <Rect x={136} y={140} width={8} height={26} rx={3} fill={P.metal} transform="rotate(30 140 153)" />
        </G>
      );
    case 'water':
      return (
        <G>
          <Ellipse cx={100} cy={174} rx={32} ry={6} fill={P.rim} />
          <Rect x={80} y={34} width={18} height={14} rx={3} fill={P.water} />
          <Path d="M76 64 Q76 50 89 50 Q102 50 102 64 L106 76 Q114 84 114 98 L114 166 Q114 174 106 174 L72 174 Q64 174 64 166 L64 98 Q64 84 72 76 Z" fill={P.water} opacity={0.55} stroke={P.metal} strokeWidth={2} />
          <Rect x={64} y={110} width={50} height={26} fill={P.laban} />
          <Path d="M72 120 h34 M72 128 h22" stroke={P.water} strokeWidth={3} strokeLinecap="round" />
        </G>
      );
    case 'laban':
      return (
        <G>
          <Ellipse cx={100} cy={170} rx={38} ry={7} fill={P.rim} />
          <Path d="M66 52 L134 52 L124 168 L76 168 Z" fill={P.laban} stroke={P.metal} strokeWidth={3} />
          <Path d="M68 66 Q84 58 100 66 Q116 74 132 66" stroke={P.rim} strokeWidth={4} fill="none" />
          {l.garnish ? <Circle cx={128} cy={50} r={8} fill={P.herb} /> : null}
        </G>
      );
    case 'can':
      return (
        <G>
          <Ellipse cx={100} cy={168} rx={40} ry={8} fill={P.rim} />
          <Rect x={72} y={44} width={56} height={124} rx={14} fill={P.can} />
          <Rect x={72} y={86} width={56} height={34} fill={P.laban} opacity={0.9} />
          <Circle cx={100} cy={103} r={11} fill={P.water} />
          <Rect x={78} y={36} width={44} height={12} rx={5} fill={P.metal} />
        </G>
      );
    case 'juice':
      return (
        <G>
          <Ellipse cx={100} cy={170} rx={38} ry={7} fill={P.rim} />
          <Path d="M66 56 L134 56 L124 168 L76 168 Z" fill={P.juice} stroke={P.metal} strokeWidth={3} />
          <Line x1={112} y1={30} x2={104} y2={120} stroke={P.tomato} strokeWidth={6} strokeLinecap="round" />
          <Circle cx={130} cy={58} r={14} fill={P.onion} stroke={P.juice} strokeWidth={3} />
          {l.garnish ? <Path d="M76 60 q6 -10 14 -4" stroke={P.herb} strokeWidth={5} fill="none" strokeLinecap="round" /> : null}
        </G>
      );
    default:
      return (
        <G>
          <Circle cx={100} cy={96} r={44} fill={l.plate} />
          {[
            [80, 84],
            [96, 74],
            [112, 80],
            [124, 94],
            [88, 98],
            [106, 96],
          ].map(([x, y], i) => (
            <Ellipse key={i} cx={x} cy={y} rx={7} ry={4} fill={P.rice} stroke={P.rim} strokeWidth={1} />
          ))}
          <Path d="M30 104 Q100 196 170 104 Z" fill={P.char} />
          <Path d="M30 104 L170 104" stroke={P.meat} strokeWidth={6} strokeLinecap="round" />
          <Steam x={100} y={44} />
        </G>
      );
  }
}

export interface FoodArtProps {
  motif: Motif;
  /** The dish's look (`artOf` / `dishArt`); 0 for a kitchen scene. */
  look?: number;
  /** Photo when the merchant has one. */
  photoUrl?: string | null;
  /** Wide hero scene (with a scatter of sesame dots) or a square dish thumbnail. */
  variant?: 'hero' | 'thumb';
  style?: StyleProp<ViewStyle>;
}

export const FoodArt = memo(function FoodArt({ motif, look = 0, photoUrl, variant = 'thumb', style }: FoodArtProps) {
  // Low-data mode (maps program q2): the drawn dish instead of downloading the photo.
  const lite = useLiteMode();
  if (photoUrl && !lite) return <Image source={{ uri: photoUrl }} style={[{ width: '100%', height: '100%' }, style as object]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  const hero = variant === 'hero';
  const l = lookOf(look);
  return (
    <View style={[{ width: '100%', height: '100%', backgroundColor: P.paper, overflow: 'hidden' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox={hero ? '0 0 400 220' : '0 0 200 200'} preserveAspectRatio="xMidYMid slice">
        {hero ? (
          <G>
            <Circle cx={330} cy={30} r={120} fill={P.juice} opacity={0.12} />
            <Circle cx={40} cy={210} r={90} fill={P.juice} opacity={0.08} />
            {Array.from({ length: 18 }, (_, i) => (
              <Ellipse key={i} cx={(i * 73) % 400} cy={20 + ((i * 47) % 190)} rx={3} ry={1.6} fill={P.char} opacity={0.18} transform={`rotate(${(i * 37) % 180} ${(i * 73) % 400} ${20 + ((i * 47) % 190)})`} />
            ))}
            <G transform="translate(110 14) scale(0.95)">
              <MotifShape motif={motif} l={l} />
            </G>
          </G>
        ) : (
          <G transform={`translate(14 14) scale(0.86) rotate(${l.tilt} 100 100)`}>
            <MotifShape motif={motif} l={l} />
          </G>
        )}
      </Svg>
    </View>
  );
});
