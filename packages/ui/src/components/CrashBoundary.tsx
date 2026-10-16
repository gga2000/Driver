import { Component, type ErrorInfo, type ReactNode } from 'react';
import { View } from 'react-native';
import { t as sharedT, type Locale } from '@driver/i18n';
import type { CrashReporter } from '@driver/contracts/crash-report';
import { useTheme } from '../theme/ThemeProvider';
import { RetryState } from './RetryState';

export interface CrashBoundaryProps {
  children: ReactNode;
  /** Where the crash goes (`createCrashReporter`); a no-op one when no DSN is set. */
  reporter?: Pick<CrashReporter, 'capture'>;
  locale?: Locale;
  /** The merchant app's own copy; customer and partner use the shared `crash.*` keys. */
  title?: string;
  body?: string;
  retryLabel?: string;
  /** Called when «جرّب مرة ثانية» is pressed, before the screens mount again. */
  onReset?: () => void;
  testID?: string;
}

interface State {
  error: unknown;
  /** Bumped on retry so the tree mounts fresh instead of reusing the broken state. */
  attempt: number;
}

/**
 * The root error boundary: a render crash anywhere below shows a calm full-screen «صار خلل» with
 * «جرّب مرة ثانية» (which mounts the screens again) instead of a white screen, and is reported
 * (scrubbed, see `@driver/contracts/crash-report`). Sits inside ThemeProvider so it can be styled.
 */
export class CrashBoundary extends Component<CrashBoundaryProps, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown render error') };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // The component stack names components only (no props), and is scrubbed with the rest.
    this.props.reporter?.capture(error, { logger: 'boundary', handled: false, extra: { componentStack: (info.componentStack ?? '').slice(0, 2000) } });
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.error) {
      const { locale, title, body, retryLabel, testID = 'crash-screen' } = this.props;
      return <CrashScreen locale={locale} title={title} body={body} retryLabel={retryLabel} testID={testID} onRetry={this.retry} />;
    }
    return <Remount key={this.state.attempt}>{this.props.children}</Remount>;
  }
}

function Remount({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export interface CrashScreenProps {
  onRetry: () => void;
  locale?: Locale;
  title?: string;
  body?: string;
  retryLabel?: string;
  testID?: string;
}

/** The crash screen itself (also in the gallery): the shared «couldn't load» state at full screen. */
export function CrashScreen({ onRetry, locale, title, body, retryLabel, testID = 'crash-screen' }: CrashScreenProps) {
  const theme = useTheme();
  const tr = (key: Parameters<typeof sharedT>[0]) => sharedT(key, undefined, locale);
  return (
    <View testID={testID} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.bg, paddingHorizontal: theme.space[4] }}>
      <RetryState
        kind="server"
        locale={locale}
        title={title ?? tr('crash.title')}
        body={body ?? tr('crash.body')}
        retryLabel={retryLabel ?? tr('crash.retry')}
        onRetry={onRetry}
        testID={`${testID}-state`}
        style={{ maxWidth: 480, width: '100%' }}
      />
    </View>
  );
}
