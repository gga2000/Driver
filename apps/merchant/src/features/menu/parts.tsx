import type { ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { DishDrawing, dishLook, motifForDish, Text, useTheme, type StatusTone } from '@driver/ui';
import { COUNTER } from '@/lib/counter';
import { Glyph, type GlyphName } from './Glyph';
import { absoluteUrl } from './photo';
import { color as palette } from '@driver/design-tokens';

/**
 * Small building blocks shared by the menu and deals screens: a big kitchen switch, round glyph
 * buttons, tappable pills, the dish thumbnail (photo or its drawing) and panel cards.
 */

export function Toggle({ value, onChange, testID, label, disabled }: { value: boolean; onChange: (v: boolean) => void; testID?: string; label: string; disabled?: boolean }) {
  const theme = useTheme();
  return (
    <Switch
      testID={testID}
      accessibilityLabel={label}
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        theme.haptic('selection');
        onChange(v);
      }}
      trackColor={{ true: theme.colors.success, false: theme.colors.borderStrong }}
      thumbColor={palette.neutral[0]}
      {...({ activeThumbColor: palette.neutral[0] } as object)}
    />
  );
}

type Variant = 'outline' | 'tonal' | 'accent' | 'plain';

export function GlyphButton({ glyph, label, onPress, variant = 'outline', size = 44, testID, disabled, color }: { glyph: GlyphName; label: string; onPress: () => void; variant?: Variant; size?: 36 | 40 | 44 | 52; testID?: string; disabled?: boolean; color?: string }) {
  const theme = useTheme();
  const bg = variant === 'accent' ? theme.colors.accent : variant === 'tonal' ? theme.colors.surfaceSunken : variant === 'outline' ? theme.colors.surface : 'transparent';
  const fg = color ?? (variant === 'accent' ? 'onAccent' : 'text');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={size < 44 ? 4 : undefined}
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: variant === 'outline' ? 1 : 0,
        borderColor: theme.colors.border,
        opacity: disabled ? theme.state.disabledOpacity : pressed ? 0.75 : 1,
      })}
    >
      <Glyph name={glyph} size={size >= 44 ? 22 : 19} color={fg} strokeWidth={2} />
    </Pressable>
  );
}

const TONE_BG: Record<StatusTone, 'surfaceSunken' | 'accentTint' | 'successTint' | 'warningTint' | 'dangerTint' | 'infoTint'> = {
  neutral: 'surfaceSunken',
  accent: 'accentTint',
  success: 'successTint',
  warning: 'warningTint',
  danger: 'dangerTint',
  info: 'surfaceSunken', // no blue on the counter
};
export const TONE_FG: Record<StatusTone, 'text' | 'accentText' | 'successText' | 'warningText' | 'dangerText' | 'infoText'> = {
  neutral: 'text',
  accent: 'accentText',
  success: 'successText',
  warning: 'warningText',
  danger: 'dangerText',
  info: 'text',
};
const TONE_DOT: Record<StatusTone, 'textMuted' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  neutral: 'textMuted',
  accent: 'accent',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  info: 'textMuted',
};

/** A pill: a tag when `onPress` is absent, a small button when present (min 36 px tall). */
export function Pill({ label, tone = 'neutral', glyph, onPress, dot, testID, size = 'md', outline, style }: { label: string; tone?: StatusTone; glyph?: GlyphName; onPress?: () => void; dot?: boolean; testID?: string; size?: 'sm' | 'md'; outline?: boolean; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const fg = TONE_FG[tone];
  const h = size === 'sm' ? 28 : 36;
  return (
    <Pressable
      testID={testID}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      disabled={!onPress}
      hitSlop={onPress && size === 'sm' ? 6 : undefined}
      onPress={() => {
        theme.haptic('light');
        onPress?.();
      }}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 6,
          height: h,
          paddingHorizontal: size === 'sm' ? 10 : 14,
          borderRadius: theme.radius.pill,
          backgroundColor: outline ? theme.colors.surface : theme.colors[TONE_BG[tone]],
          borderWidth: outline ? 1 : 0,
          borderColor: theme.colors.borderStrong,
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors[TONE_DOT[tone]] }} /> : null}
      {glyph ? <Glyph name={glyph} size={size === 'sm' ? 15 : 17} color={fg} strokeWidth={2} /> : null}
      <Text variant={size === 'sm' ? 'caption' : 'label'} weight={600} color={fg} numberOfLines={1} tabular>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Dish photo, or (p2, until a photo arrives) the drawing customers see for that dish: the locked Date &
 * Saffron set, picked from the dish's name and section by the same rules as the customer app.
 */
export function Thumb({ url, name, size = 64, dim, radius, id, section }: { url: string | null; name: string; size?: number; dim?: boolean; radius?: number; id?: string; section?: string | null }) {
  const r = radius ?? Math.round(size * 0.22);
  return (
    <View style={{ width: size, height: size, borderRadius: r, overflow: 'hidden', backgroundColor: COUNTER.sand, opacity: dim ? 0.5 : 1 }}>
      {url ? <Image source={{ uri: absoluteUrl(url) }} recyclingKey={id ?? url} transition={120} style={{ width: size, height: size }} contentFit="cover" accessibilityIgnoresInvertColors /> : <DishArt name={name} id={id} section={section} />}
    </View>
  );
}

/** The drawn dish, filling its box (no photo yet). Decorative: the name is always written beside it. */
export function DishArt({ name, id, section }: { name: string; id?: string | undefined; section?: string | null | undefined }) {
  return (
    <View style={{ width: '100%', height: '100%' }} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
        <G transform="translate(8 6) scale(0.92)">
          <DishDrawing kind={motifForDish(name, section ?? undefined)} look={dishLook(id ?? name)} />
        </G>
      </Svg>
    </View>
  );
}

/** A white panel with a hairline border (the menu's sections, the editor's groups). */
export function Panel({ children, style, padded = true, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[{ backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl, borderWidth: 1, borderColor: theme.colors.border, padding: padded ? theme.space[4] : 0, gap: padded ? theme.space[3] : 0 }, style]}>
      {children}
    </View>
  );
}

/** Heading inside a panel or a form, with an optional end node. */
export function PanelTitle({ title, hint, aside, glyph }: { title: string; hint?: string; aside?: ReactNode; glyph?: GlyphName }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      {glyph ? (
        <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          <Glyph name={glyph} size={19} color="accentText" strokeWidth={2} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        {hint ? (
          <Text variant="footnote" color="textMuted">
            {hint}
          </Text>
        ) : null}
      </View>
      {aside}
    </View>
  );
}

/** A selectable card-sized choice (deal kind, duration…). */
export function ChoiceTile({ selected, onPress, children, testID, style }: { selected: boolean; onPress: () => void; children: ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => [
        {
          borderRadius: theme.radius.lg,
          borderWidth: selected ? 2 : 1,
          borderColor: selected ? theme.colors.accent : theme.colors.border,
          backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
          padding: selected ? theme.space[4] - 1 : theme.space[4],
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
