import { memo } from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { useTheme } from '@driver/ui';

/**
 * Warm illustrated placeholder for kitchens and dishes without a photo yet (every launch merchant
 * today): a cream-and-orange plate scene whose motif follows the food — skewers for grills, a spit
 * for shawarma, an istikan of tea for breakfast places, a rice bowl otherwise. A photo url, when the
 * merchant uploads one, replaces it.
 */
export type Motif = 'skewers' | 'shawarma' | 'falafel' | 'tea' | 'drink' | 'bowl' | 'bread' | 'salad';

const DISH_MOTIFS: Array<[RegExp, Motif]> = [
  [/چاي|شاي|قهوة/, 'tea'],
  [/بيبسي|ماي|عصير|ليمون|لبن|شنينة|سفن/, 'drink'],
  [/سلطة|حمص|جاجيك|طرشي/, 'salad'],
  [/شاورما|صاج/, 'shawarma'],
  [/فلافل/, 'falafel'],
  [/كباب|تكة|تكه|كبد|مشوي|طاووق|مشكّل|مشكل|لفة/, 'skewers'],
  [/خبز|منقوشة|كاهي|عجين|صمون/, 'bread'],
];

export function motifForDish(name: string): Motif {
  for (const [re, m] of DISH_MOTIFS) if (re.test(name)) return m;
  return 'bowl';
}

export function motifForKitchen(tags: readonly string[]): Motif {
  if (tags.includes('shawarma')) return 'shawarma';
  if (tags.includes('breakfast') || tags.includes('pacha')) return 'tea';
  if (tags.includes('grill') || tags.includes('kebab')) return 'skewers';
  if (tags.includes('falafel')) return 'falafel';
  return 'bowl';
}

interface Palette {
  bg: string;
  plate: string;
  rim: string;
  meat: string;
  char: string;
  tomato: string;
  onion: string;
  herb: string;
  metal: string;
  tea: string;
  glass: string;
  dot: string;
}

function usePalette(): Palette {
  const c = useTheme().colors;
  return {
    bg: c.accentTint,
    plate: c.surface,
    rim: c.border,
    meat: '#A0561C',
    char: c.accentText,
    tomato: c.danger,
    onion: c.warningTint,
    herb: c.success,
    metal: c.borderStrong,
    tea: '#B5521B',
    glass: c.bg,
    dot: c.accent,
  };
}

/** The motif drawn in a 200 × 200 box centred on (100, 100). */
function MotifShape({ motif, p }: { motif: Motif; p: Palette }) {
  switch (motif) {
    case 'skewers':
      return (
        <G>
          <Ellipse cx={100} cy={118} rx={86} ry={50} fill={p.plate} stroke={p.rim} strokeWidth={3} />
          {[-16, 4, 24].map((dy, i) => (
            <G key={i} transform={`rotate(-14 100 ${100 + dy})`}>
              <Line x1={22} y1={100 + dy} x2={182} y2={100 + dy} stroke={p.metal} strokeWidth={3} strokeLinecap="round" />
              {[0, 1, 2, 3, 4].map((k) => (
                <Rect
                  key={k}
                  x={42 + k * 24}
                  y={91 + dy}
                  width={20}
                  height={18}
                  rx={7}
                  fill={k === 2 && i !== 1 ? p.tomato : k % 2 ? p.char : p.meat}
                />
              ))}
            </G>
          ))}
          <Path d="M150 70 q8 -10 0 -20 q-8 -10 0 -20" stroke={p.dot} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.5} />
          <Circle cx={52} cy={142} r={6} fill={p.herb} />
          <Circle cx={64} cy={148} r={5} fill={p.herb} opacity={0.8} />
        </G>
      );
    case 'shawarma':
      return (
        <G>
          <Ellipse cx={100} cy={170} rx={56} ry={12} fill={p.rim} />
          <Line x1={100} y1={18} x2={100} y2={172} stroke={p.metal} strokeWidth={4} strokeLinecap="round" />
          <Path d="M66 40 L134 40 L122 160 L78 160 Z" fill={p.meat} />
          {[58, 80, 102, 124, 146].map((y) => (
            <Path key={y} d={`M${68 + (y - 40) * 0.1} ${y} L${132 - (y - 40) * 0.1} ${y}`} stroke={p.char} strokeWidth={5} strokeLinecap="round" opacity={0.75} />
          ))}
          <Path d="M66 40 L134 40" stroke={p.char} strokeWidth={6} strokeLinecap="round" />
          <Path d="M144 120 q22 -8 30 10 q-14 24 -36 14 z" fill={p.onion} stroke={p.rim} strokeWidth={2} />
        </G>
      );
    case 'falafel':
      return (
        <G>
          <Ellipse cx={100} cy={118} rx={80} ry={46} fill={p.plate} stroke={p.rim} strokeWidth={3} />
          {[
            [70, 108],
            [100, 100],
            [130, 108],
            [86, 128],
            [116, 128],
          ].map(([x, y], i) => (
            <G key={i}>
              <Circle cx={x} cy={y} r={15} fill={p.meat} />
              <Circle cx={x! - 4} cy={y! - 4} r={4} fill={p.herb} opacity={0.6} />
            </G>
          ))}
        </G>
      );
    case 'tea':
      return (
        <G>
          <Ellipse cx={100} cy={160} rx={62} ry={14} fill={p.plate} stroke={p.rim} strokeWidth={3} />
          <Path d="M72 62 Q66 100 82 112 Q66 126 74 156 L126 156 Q134 126 118 112 Q134 100 128 62 Z" fill={p.glass} stroke={p.metal} strokeWidth={3} />
          <Path d="M76 84 Q72 102 84 112 Q71 125 78 152 L122 152 Q129 125 116 112 Q128 102 124 84 Z" fill={p.tea} />
          <Path d="M88 52 q8 -10 0 -20 M104 50 q8 -10 0 -20 M120 52 q8 -10 0 -20" stroke={p.dot} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.55} />
          <Rect x={136} y={140} width={8} height={26} rx={3} fill={p.metal} transform="rotate(30 140 153)" />
        </G>
      );
    case 'drink':
      return (
        <G>
          <Ellipse cx={100} cy={168} rx={40} ry={8} fill={p.rim} />
          <Rect x={72} y={44} width={56} height={124} rx={14} fill={p.tomato} />
          <Rect x={72} y={86} width={56} height={34} fill={p.plate} opacity={0.9} />
          <Circle cx={100} cy={103} r={11} fill={p.dot} />
          <Rect x={78} y={36} width={44} height={12} rx={5} fill={p.metal} />
        </G>
      );
    case 'bread':
      return (
        <G>
          <Ellipse cx={100} cy={112} rx={84} ry={52} fill={p.meat} opacity={0.35} />
          <Ellipse cx={100} cy={106} rx={76} ry={44} fill={p.onion} stroke={p.char} strokeWidth={3} />
          {[
            [76, 96],
            [104, 88],
            [126, 108],
            [92, 120],
            [116, 126],
          ].map(([x, y], i) => (
            <Circle key={i} cx={x} cy={y} r={4} fill={p.herb} opacity={0.7} />
          ))}
        </G>
      );
    case 'salad':
      return (
        <G>
          <Path d="M30 104 Q100 190 170 104 Z" fill={p.plate} stroke={p.rim} strokeWidth={3} />
          <Circle cx={74} cy={98} r={14} fill={p.herb} />
          <Circle cx={100} cy={92} r={16} fill={p.herb} opacity={0.85} />
          <Circle cx={126} cy={98} r={14} fill={p.tomato} />
          <Circle cx={100} cy={106} r={10} fill={p.onion} />
        </G>
      );
    default:
      return (
        <G>
          <Circle cx={100} cy={96} r={44} fill={p.plate} />
          {[
            [80, 84],
            [96, 74],
            [112, 80],
            [124, 94],
            [88, 98],
            [106, 96],
          ].map(([x, y], i) => (
            <Ellipse key={i} cx={x} cy={y} rx={7} ry={4} fill={p.onion} stroke={p.rim} strokeWidth={1} />
          ))}
          <Path d="M30 104 Q100 196 170 104 Z" fill={p.char} />
          <Path d="M30 104 L170 104" stroke={p.meat} strokeWidth={6} strokeLinecap="round" />
          <Path d="M84 44 q8 -10 0 -20 M116 44 q8 -10 0 -20" stroke={p.dot} strokeWidth={3} fill="none" strokeLinecap="round" opacity={0.55} />
        </G>
      );
  }
}

export interface FoodArtProps {
  motif: Motif;
  /** Photo when the merchant has one. */
  photoUrl?: string | null;
  /** Wide hero scene (with a scatter of sesame dots) or a square dish thumbnail. */
  variant?: 'hero' | 'thumb';
  style?: StyleProp<ViewStyle>;
}

export const FoodArt = memo(function FoodArt({ motif, photoUrl, variant = 'thumb', style }: FoodArtProps) {
  const p = usePalette();
  if (photoUrl) return <Image source={{ uri: photoUrl }} style={[{ width: '100%', height: '100%' }, style as object]} resizeMode="cover" accessibilityIgnoresInvertColors />;
  const hero = variant === 'hero';
  return (
    <View style={[{ width: '100%', height: '100%', backgroundColor: p.bg, overflow: 'hidden' }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox={hero ? '0 0 400 220' : '0 0 200 200'} preserveAspectRatio="xMidYMid slice">
        {hero ? (
          <G>
            <Circle cx={330} cy={30} r={120} fill={p.dot} opacity={0.12} />
            <Circle cx={40} cy={210} r={90} fill={p.dot} opacity={0.08} />
            {Array.from({ length: 18 }, (_, i) => (
              <Ellipse key={i} cx={(i * 73) % 400} cy={20 + ((i * 47) % 190)} rx={3} ry={1.6} fill={p.char} opacity={0.18} transform={`rotate(${(i * 37) % 180} ${(i * 73) % 400} ${20 + ((i * 47) % 190)})`} />
            ))}
            <G transform="translate(110 14) scale(0.95)">
              <MotifShape motif={motif} p={p} />
            </G>
          </G>
        ) : (
          <G transform="translate(14 14) scale(0.86)">
            <MotifShape motif={motif} p={p} />
          </G>
        )}
      </Svg>
    </View>
  );
});
