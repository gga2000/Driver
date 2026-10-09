import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { OpsTaskKind } from '@driver/contracts';
import { Icon, Text, resolveColor, useTheme, withAlpha, type ColorValue, type IconName } from '@driver/ui';
import { DigitPad } from '@/components/DigitPad';
import { useT } from '@/lib/i18n';
import { CODE_LENGTH, type PadKey } from './logic';

/** Camera glyph (the shared icon set has none yet): same 24-unit grid and stroke as `@driver/ui` icons. */
export function CameraGlyph({ size = 24, color = 'text', strokeWidth = 2 }: { size?: number; color?: ColorValue; strokeWidth?: number }) {
  const theme = useTheme();
  const c = resolveColor(theme, color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.3-1.9A1.5 1.5 0 0 1 10.6 3.5h2.8a1.5 1.5 0 0 1 1.2.6L15.9 6h1.6A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8Z" stroke={c} strokeWidth={strokeWidth} strokeLinejoin="round" />
      <Circle cx={12} cy={12.5} r={3.4} stroke={c} strokeWidth={strokeWidth} />
      <Rect x={16.6} y={8.6} width={1.2} height={1.2} rx={0.6} fill={c} />
    </Svg>
  );
}

/** A big action on the ops home: icon, title, one line of help. `dark` is the money action. */
export function ActionTile({
  icon,
  glyph,
  title,
  sub,
  onPress,
  dark,
  meta,
  style,
  testID,
}: {
  icon?: IconName;
  glyph?: 'camera';
  title: string;
  sub: string;
  onPress: () => void;
  dark?: boolean;
  meta?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  // Check-up item 4: the lead tile is ink by day; at night a raised ember panel, never a cream block.
  const night = theme.scheme === 'dark';
  const fg = dark && !night ? theme.colors.bg : theme.colors.text;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        {
          borderRadius: theme.radius.xl,
          padding: theme.space[4],
          gap: theme.space[3],
          backgroundColor: dark ? (night ? theme.colors.surfaceRaised : theme.colors.text) : theme.colors.surface,
          borderWidth: dark ? (night ? 1.5 : 0) : 1,
          borderColor: dark && night ? theme.colors.accentBorder : theme.colors.border,
          opacity: pressed ? 0.88 : 1,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: dark ? theme.colors.accent : theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
          {glyph === 'camera' ? <CameraGlyph size={24} color="accentText" /> : <Icon name={icon ?? 'plus'} size={22} color={dark ? 'onAccent' : 'accentText'} strokeWidth={2.2} />}
        </View>
        {meta ? (
          <View style={{ backgroundColor: withAlpha(fg, dark ? 0.14 : 0), borderRadius: theme.radius.pill, paddingHorizontal: 10, paddingVertical: 2 }}>
            <Text variant="caption" weight={600} tabular style={{ color: dark ? fg : theme.colors.textMuted }}>
              {meta}
            </Text>
          </View>
        ) : (
          <Icon name="chevron-forward" size={18} color={dark ? fg : 'textMuted'} />
        )}
      </View>
      <View style={{ gap: 2 }}>
        <Text variant="title" style={{ color: fg }}>
          {title}
        </Text>
        <Text variant="footnote" numberOfLines={2} style={{ color: withAlpha(fg, 0.68) }}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

export const TASK_ICON: Record<OpsTaskKind, IconName> = { cash_collection: 'wallet', merchant_followup: 'bag', landmark_photo: 'map-pin', document_check: 'receipt' };

/** The four boxes of the hand-over code; the current box is outlined in the accent. */
export function CodeBoxes({ code, error }: { code: string; error?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', direction: 'ltr', gap: theme.space[2], justifyContent: 'center' }} testID="ops-code-boxes">
      {Array.from({ length: CODE_LENGTH }, (_, i) => {
        const digit = code[i];
        const current = i === code.length;
        return (
          <View
            key={i}
            style={{
              width: 56,
              height: 64,
              borderRadius: theme.radius.lg,
              backgroundColor: digit ? theme.colors.surface : theme.colors.surfaceSunken,
              borderWidth: 2,
              borderColor: error ? theme.colors.danger : current ? theme.colors.accent : digit ? theme.colors.border : 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="display" tabular>
              {digit ?? ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** Numeric keypad for the code: the app's one keypad (`DigitPad`). */
export function CodePad({ onKey, disabled }: { onKey: (k: PadKey) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <DigitPad
      testID="ops-code-pad"
      keyTestID={(k) => `ops-pad-${k === 'back' ? 'del' : k}`}
      deleteLabel={t('partner.ops_cash_clear')}
      disabled={disabled}
      onKey={(k) => onKey(k === 'back' ? 'del' : k)}
    />
  );
}

/** Step progress for the onboarding wizard: one segment per step. */
export function StepBar({ total, index }: { total: number; index: number }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i <= index ? theme.colors.accent : theme.colors.surfaceSunken }} />
      ))}
    </View>
  );
}
