import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Button, getNetwork, Icon, RetryState, retryKindFor, StaleNote, Text, useLoadTimeout, useNetwork, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';

/** The bits of a React Query result a screen needs to pick its state. */
export interface QueryState<T> {
  data: T | undefined;
  isError: boolean;
  error: unknown;
  dataUpdatedAt?: number;
  refetch: () => unknown;
}

export interface LoadableProps<T> {
  query: QueryState<T>;
  /** Shown while the first fetch runs. */
  skeleton: ReactNode;
  /** «ما گدرنا نجيب …»: what failed, in the screen's words; a plain "couldn't load" when left out. */
  failed?: string;
  /** Inside a panel: one line and a retry, not the full-screen state. */
  compact?: boolean;
  /** Mark the data as old while the app can't refresh it (default on). */
  stale?: boolean;
  testID: string;
  children: (data: T) => ReactNode;
}

/**
 * Counter step 6: every read on the merchant app shows one of four things. While the first
 * fetch runs, its skeleton; with data, the screen (marked «معروض من آخر مرة» while offline); when the
 * fetch fails, or is still running after the slow-load timeout, what went wrong and a retry, never a
 * skeleton that spins forever. Empty states stay with each screen, which knows what to offer next.
 */
export function Loadable<T>({ query, skeleton, failed, compact, stale = true, testID, children }: LoadableProps<T>) {
  const net = useNetwork();
  const [slow, restart] = useLoadTimeout(query.data === undefined && !query.isError);
  if (query.data !== undefined) {
    return (
      <>
        {stale ? <StaleNote updatedAt={query.dataUpdatedAt} testID={`${testID}-stale`} /> : null}
        {children(query.data)}
      </>
    );
  }
  if (!query.isError && !slow) return <>{skeleton}</>;
  const retry = () => {
    restart();
    getNetwork().retryNow();
    void query.refetch();
  };
  const kind = retryKindFor({ net, error: query.isError ? query.error : undefined, slow });
  return compact ? <LoadFailedLine kind={kind} title={failed} onRetry={retry} testID={`${testID}-error`} /> : <LoadFailedScreen kind={kind} title={failed} onRetry={retry} testID={`${testID}-error`} />;
}

/** For a screen that checks its own data first: the skeleton, or the failure once the read failed. */
export function LoadPending({ query, ...rest }: Omit<LoadableProps<unknown>, 'children' | 'stale'>) {
  return (
    <Loadable query={{ ...query, data: undefined }} stale={false} {...rest}>
      {() => null}
    </Loadable>
  );
}

type Kind = ReturnType<typeof retryKindFor>;

function LoadFailedScreen({ kind, title, onRetry, testID }: { kind: Kind; title?: string; onRetry: () => void; testID: string }) {
  const t = useT();
  const locale = useLocale();
  return <RetryState kind={kind} locale={locale} title={kind === 'offline' ? undefined : title} retryLabel={t('merchant.menu.retry')} onRetry={onRetry} testID={testID} />;
}

/** A panel's own failure: an icon, one line, and «جرّب مرة ثانية». */
export function LoadFailedLine({ kind, title, onRetry, testID }: { kind: Kind; title?: string; onRetry: () => void; testID: string }) {
  const t = useT();
  const theme = useTheme();
  const line = kind === 'offline' ? t('merchant.load.offline') : (title ?? t('merchant.load.failed'));
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ gap: theme.space[3], alignItems: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name={kind === 'server' ? 'shield' : kind === 'slow' ? 'clock' : 'wifi-off'} size={18} color="textMuted" strokeWidth={2} />
        <Text variant="body" color="textMuted" style={{ flexShrink: 1 }}>
          {line}
        </Text>
      </View>
      <Button testID={`${testID}-retry`} label={t('merchant.menu.retry')} icon="refresh" variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

/** Two reads that one view needs together: ready when both are, failed when either failed with nothing kept. */
export function both<A, B>(a: QueryState<A>, b: QueryState<B>): QueryState<[A, B]> {
  const aFailed = a.isError && a.data === undefined;
  const updated = Math.min(a.dataUpdatedAt || Infinity, b.dataUpdatedAt || Infinity);
  return {
    data: a.data !== undefined && b.data !== undefined ? [a.data, b.data] : undefined,
    isError: aFailed || (b.isError && b.data === undefined),
    error: aFailed ? a.error : b.error,
    dataUpdatedAt: Number.isFinite(updated) ? updated : 0,
    refetch: () => {
      if (a.data === undefined) void a.refetch();
      if (b.data === undefined) void b.refetch();
    },
  };
}
