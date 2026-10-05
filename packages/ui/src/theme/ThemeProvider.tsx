import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { I18nManager, Platform, View, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import {
  elevation,
  fontFace,
  fontFamily,
  fontScale,
  hitTarget,
  motion,
  radius,
  space,
  state,
  themes,
  type,
  type FontWeight,
  type ThemeColors,
  type ThemeName,
} from '@driver/design-tokens';

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';
/** Apps pass an expo-haptics adapter; the UI package never imports a native module itself. */
export type HapticHandler = (kind: HapticKind) => void;

export type Direction = 'rtl' | 'ltr';

/**
 * `plex`: IBM Plex Sans Arabic is loaded (expo-font on native, @font-face on web).
 * `system`: fall back to the platform face with `fontWeight` (apps that have not loaded fonts yet).
 */
export type FontMode = 'plex' | 'system';

export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
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
}

const noopHaptic: HapticHandler = () => {};

const webStack = fontFamily.sans.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ');

export function fontStyle(weight: FontWeight, mode: FontMode): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  const fontWeight = String(weight) as TextStyle['fontWeight'];
  if (Platform.OS === 'web') return { fontFamily: webStack, fontWeight };
  // Native: one family per weight file; setting fontWeight too would make Android fake-bold it.
  if (mode === 'plex') return { fontFamily: fontFace[weight] };
  return { fontWeight };
}

export function createTheme(
  name: ThemeName = 'light',
  opts: { direction?: Direction; fonts?: FontMode; reduceMotion?: boolean; haptic?: HapticHandler } = {},
): Theme {
  const direction = opts.direction ?? 'rtl';
  const fonts = opts.fonts ?? 'plex';
  return {
    name,
    colors: themes[name],
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
  };
}

const ThemeContext = createContext<Theme>(createTheme('light'));

export interface ThemeProviderProps {
  /** Light is the launch default; dark is a stub built on the same token names. */
  theme?: ThemeName;
  /** Defaults to the native layout direction (RTL in every Driver app). */
  direction?: Direction;
  fonts?: FontMode;
  haptics?: HapticHandler;
  /** Force reduced motion; otherwise follows the OS setting. */
  reduceMotion?: boolean;
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

export function ThemeProvider({ theme = 'light', direction, fonts, haptics, reduceMotion, children }: ThemeProviderProps) {
  const osReduceMotion = useReducedMotion();
  const dir: Direction = direction ?? (Platform.OS === 'web' || I18nManager.isRTL ? 'rtl' : 'ltr');
  const value = useMemo(
    () => createTheme(theme, { direction: dir, fonts, haptic: haptics, reduceMotion: reduceMotion ?? osReduceMotion }),
    [theme, dir, fonts, haptics, reduceMotion, osReduceMotion],
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
