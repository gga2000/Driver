import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { ThemeName } from '@driver/design-tokens';
import { ThemeProvider, type HapticHandler } from '../theme/ThemeProvider';

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/**
 * Renders through react-native-web inside the light RTL theme (also on `rerender`), with motion
 * reduced by default so values land immediately.
 */
export function renderUI(ui: ReactElement, opts: { haptics?: HapticHandler; reduceMotion?: boolean; theme?: ThemeName } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider theme={opts.theme ?? 'light'} direction="rtl" reduceMotion={opts.reduceMotion ?? true} haptics={opts.haptics}>
        {children}
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
