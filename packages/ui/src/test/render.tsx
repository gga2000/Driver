import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { ThemeProvider, type HapticHandler } from '../theme/ThemeProvider';

/**
 * Renders through react-native-web inside the light RTL theme (also on `rerender`), with motion
 * reduced by default so values land immediately.
 */
export function renderUI(ui: ReactElement, opts: { haptics?: HapticHandler; reduceMotion?: boolean } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <ThemeProvider theme="light" direction="rtl" reduceMotion={opts.reduceMotion ?? true} haptics={opts.haptics}>
      {children}
    </ThemeProvider>
  );
  return render(ui, { wrapper: Wrapper });
}
