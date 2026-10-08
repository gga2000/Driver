import { View, type StyleProp, type ViewStyle } from 'react-native';
import { PhotoImage } from './PhotoImage';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/paths';
import { usePhotoFallback } from '../logic/photo-fallback';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

export type AvatarTone = 'accent' | 'info' | 'success' | 'warning';

const TONES: Record<AvatarTone, { bg: ThemeColorKey; fg: ThemeColorKey }> = {
  accent: { bg: 'accentTint', fg: 'accentText' },
  info: { bg: 'infoTint', fg: 'infoText' },
  success: { bg: 'successTint', fg: 'successText' },
  warning: { bg: 'warningTint', fg: 'warningText' },
};
const ORDER: AvatarTone[] = ['accent', 'info', 'success', 'warning'];

function nameHash(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
}

/** Stable tone per name so "سارة" is always the same colour across cart, checkout and merchant ticket. */
export function toneFor(name: string): AvatarTone {
  return ORDER[nameHash(name) % ORDER.length]!;
}

/**
 * Stable slot in the theme's identity palette (`theme.identity`, joy S2-03). With the four light
 * colours this is exactly `toneFor`'s order, so the Partner and Merchant avatars keep their colours.
 */
export function identityIndex(name: string, size: number): number {
  return nameHash(name) % size;
}

/** First letter, skipping "ال" so "العزيزية" reads ع not ا. */
export function initialOf(name: string): string {
  const n = name.trim().replace(/^ال(?=\S{2,})/, '');
  return Array.from(n)[0] ?? '?';
}

export interface AvatarProps {
  name?: string;
  uri?: string;
  /** Glyph instead of an initial (e.g. `plus` for "ضيف شخص", `user` for unknown). */
  icon?: IconName;
  size?: number;
  tone?: AvatarTone;
  /** Accent ring: selected person, "verified today" driver. */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Avatar({ name = '', uri, icon, size = 40, tone, ring, style }: AvatarProps) {
  const theme = useTheme();
  // An explicit tone is a meaning ("ضيف شخص", unnamed driver); a name gets a non-semantic identity colour.
  const id = theme.identity[identityIndex(name, theme.identity.length)]!;
  const t = tone ? { bg: theme.colors[TONES[tone].bg], fg: theme.colors[TONES[tone].fg] } : { bg: id.fill, fg: id.on };
  const inner = ring ? size - 6 : size;
  // An expired signed link shows the initial (or icon), not a broken image.
  const photo = usePhotoFallback(uri);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: ring ? 2 : 0,
          borderColor: theme.colors.accent,
        },
        style,
      ]}
    >
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: t.bg,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {photo.uri ? (
          <PhotoImage uri={photo.uri} onError={photo.onError} style={{ width: inner, height: inner }} />
        ) : icon ? (
          <Icon name={icon} size={Math.round(inner * 0.5)} color={t.fg} strokeWidth={2} />
        ) : (
          <Text
            weight={700}
            color={t.fg}
            style={{ fontSize: Math.round(inner * 0.42), lineHeight: Math.round(inner * 0.62) }}
          >
            {initialOf(name)}
          </Text>
        )}
      </View>
    </View>
  );
}
