import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { I18nManager, Platform, View, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import {
  brandFace,
  elevation,
  fontFace,
  fontFamily,
  fontScale,
  haptic as hapticTokens,
  hitTarget,
  identity,
  motion,
  radius,
  scheme,
  space,
  state,
  themes,
  type,
  type BrandFace,
  type FontWeight,
  type IdentityColor,
  type ThemeColors,
  type ThemeName,
} from '@driver/design-tokens';

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
/** Apps pass an expo-haptics adapter; the UI package never imports a native module itself. */
export type HapticHandler = (kind: HapticKind) => void;

export type Direction = 'rtl' | 'ltr';

/**
 * `plex`: IBM Plex Sans Arabic is loaded (expo-font on native, @font-face on web).
 * `brand`: Plex plus the brand faces (Alexandria, Marhey: the customer app, joy J-D2).
 * `system`: fall back to the platform face with `fontWeight` (apps that have not loaded fonts yet).
 */
export type FontMode = 'plex' | 'brand' | 'system';

export interface Theme {
  name: ThemeName;
  /** Which way the theme leans (toasts, state layers, shadows): never test `name` for that. */
  scheme: 'light' | 'dark';
  colors: ThemeColors;
  /** Monogram colours (`Avatar` without a tone): non-semantic in istikan. */
  identity: readonly IdentityColor[];
  /** What a secondary or ghost `Button` buzzes: nothing in istikan (joy S2-18). */
  secondaryButtonHaptic: HapticKind | null;
  space: typeof space;
  radius: typeof radius;
  type: typeof type;
  motion: typeof motion;
  elevation: typeof elevation;
  state: typeof state;
  hitTarget: number;
  /** Large-text caps for compact controls (`fontScale.compact`). */
  fontScale: typeof fontScale;
  direction: Direction;
  isRTL: boolean;
  fonts: FontMode;
  reduceMotion: boolean;
  haptic: HapticHandler;
  /** Font family/weight style for a weight, correct for the platform and font mode. */
  font: (weight: FontWeight) => Pick<TextStyle, 'fontFamily' | 'fontWeight'>;
  /** Font style for a brand face (Alexandria `display`, Marhey `voice`); Plex Bold until they load. */
  face: (face: BrandFace) => Pick<TextStyle, 'fontFamily' | 'fontWeight'>;
}

const noopHaptic: HapticHandler = () => {};

const cssStack = (stack: readonly string[]) => stack.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');
const webStack = cssStack(fontFamily.sans);
const webFace: Record<BrandFace, string> = { display: cssStack(fontFamily.display), voice: cssStack(fontFamily.voice) };

export function fontStyle(weight: FontWeight, mode: FontMode): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  const fontWeight = String(weight) as TextStyle['fontWeight'];
  if (Platform.OS === 'web') return { fontFamily: webStack, fontWeight };
  // Native: one family per weight file; setting fontWeight too would make Android fake-bold it.
  if (mode === 'plex' || mode === 'brand') return { fontFamily: fontFace[weight] };
  return { fontWeight };
}

/**
 * A brand face. Web: the CSS stack (Alexandria/Marhey first, Plex behind, so a page that never loads
 * them looks as before). Native: the bundled file once loaded (`brand`), else Plex Bold.
 */
export function faceStyle(face: BrandFace, mode: FontMode): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  if (Platform.OS === 'web') return { fontFamily: webFace[face], fontWeight: '700' };
  if (mode === 'brand') return { fontFamily: brandFace[face] };
  return fontStyle(700, mode);
}

export function createTheme(
  name: ThemeName = 'light',
  opts: { direction?: Direction; fonts?: FontMode; reduceMotion?: boolean; haptic?: HapticHandler; colors?: ThemeColors } = {},
): Theme {
  const direction = opts.direction ?? 'rtl';
  const fonts = opts.fonts ?? 'plex';
  return {
    name,
    scheme: scheme[name],
    colors: opts.colors ?? themes[name],
    identity: identity[name],
    secondaryButtonHaptic: hapticTokens.secondaryButton[name],
    space,
    radius,
    type,
    motion,
    elevation,
    state,
    hitTarget,
    fontScale,
    direction,
    isRTL: direction === 'rtl',
    fonts,
    reduceMotion: opts.reduceMotion ?? false,
    haptic: opts.haptic ?? noopHaptic,
    font: (w) => fontStyle(w, fonts),
    face: (f) => faceStyle(f, fonts),
  };
}

const ThemeContext = createContext<Theme>(createTheme('light'));

export interface ThemeProviderProps {
  /** `light` for the Partner and Merchant apps, `istikan` for the customer app; dark is a stub on the same roles. */
  theme?: ThemeName;
  /** Defaults to the native layout direction (RTL in every Driver app). */
  direction?: Direction;
  fonts?: FontMode;
  haptics?: HapticHandler;
  /** Force reduced motion; otherwise follows the OS setting. */
  reduceMotion?: boolean;
  /**
   * An app's own complete role palette over `theme`'s structure (the Partner app's «الدشبول» sun and
   * ember, `partnerThemes`). `theme` still decides everything else (scheme, haptics, monograms).
   */
  colors?: ThemeColors;
  children: ReactNode;
}

/**
 * Web keyboard focus (audit S-13): every focusable control (react-native-web renders Pressables with
 * a tabindex) gets a 2 px ink ring, 2 px off the control so the screen shows between them, only for
 * keyboard focus (`:focus-visible`), never on a tap. Text fields draw their own focused border.
 */
export function focusRingCss(color: string, width: number = state.focusRingWidth, offset: number = state.focusRingOffset): string {
  return [
    `[tabindex]:focus-visible,button:focus-visible,a:focus-visible{outline:${width}px solid ${color} !important;outline-offset:${offset}px !important}`,
    `[tabindex]:focus:not(:focus-visible){outline:none}`,
  ].join('\n');
}

const FOCUS_STYLE_ID = 'driver-focus-ring';

function useWebFocusRing(color: string) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let el = document.getElementById(FOCUS_STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = FOCUS_STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = focusRingCss(color);
  }, [color]);
}

export function ThemeProvider({ theme = 'light', direction, fonts, haptics, reduceMotion, colors, children }: ThemeProviderProps) {
  const osReduceMotion = useReducedMotion();
  const dir: Direction = direction ?? (Platform.OS === 'web' || I18nManager.isRTL ? 'rtl' : 'ltr');
  const value = useMemo(
    () => createTheme(theme, { direction: dir, fonts, haptic: haptics, reduceMotion: reduceMotion ?? osReduceMotion, colors }),
    [theme, dir, fonts, haptics, reduceMotion, osReduceMotion, colors],
  );
  useWebFocusRing(value.colors.focusRing);
  return (
    <ThemeContext.Provider value={value}>
      {/* On web the direction must be set on the DOM; on native I18nManager already flips layout. */}
      {Platform.OS === 'web' ? (
        <View style={{ flex: 1, direction: dir }} {...({ dir } as object)}>
          {children}
        </View>
      ) : (
        children
      )}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
