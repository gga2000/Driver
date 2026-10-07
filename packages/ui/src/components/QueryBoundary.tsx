import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { classifyError } from '@driver/contracts/net-client';
import { t as sharedT, type Locale } from '@driver/i18n';
import type { IconName } from '../icons/paths';
import { getNetwork, retryKindFor, useLoadTimeout, useNetwork } from '../network/network';
import { useTheme } from '../theme/ThemeProvider';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { RetryState, type RetryKind } from './RetryState';
import { StaleNote } from './StaleNote';

/** The part of a React Query result the boundary reads (structural: this package doesn't depend on React Query). */
export interface QueryLike<T> {
  data: T | undefined;
  error: unknown;
  isPending: boolean;
  isError: boolean;
  /** `paused`: React Query is waiting for the network to come back. */
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  dataUpdatedAt?: number;
  refetch: () => unknown;
}

/** What a screen says in one of its states (each falls back to the shared wording). */
export interface QueryStateCopy {
  title?: string;
  body?: string;
  art?: ReactNode;
}

export interface QueryBoundaryProps<T> {
  query: QueryLike<T>;
  /** The screen with its data. */
  children: (data: T) => ReactNode;
  /** Shown while the first load is out (the screen's own shaped skeleton). */
  skeleton: ReactNode;
  /** True when the data is there but there is nothing to show (an empty list). */
  isEmpty?: (data: T) => boolean;
  /** The empty state: an invitation to act (voice spec). Required with `isEmpty`. */
  empty?: EmptyStateProps;
  /**
   * The server's final "this isn't there" (not found, forbidden: an old link, a deleted order). Without
   * it the server's own words show, with a retry.
   */
  gone?: { icon: IconName; title: string; body?: string; action?: EmptyStateProps['action'] };
  /** Per-kind overrides of the "couldn't load" state ("المنيو ما وصل" instead of the generic words). */
  retry?: Partial<Record<RetryKind, QueryStateCopy>>;
  /** A drawing for offline / unreachable (the offline Tigris), unless `retry` gives one. */
  offlineArt?: ReactNode;
  /** Mark data kept from an earlier load as old while it can't be refreshed (default on). */
  staleNote?: boolean;
  /** Skeleton turns into "slow" after this long (default `NET_RULES.slowLoadMs`). */
  slowMs?: number;
  locale?: Locale;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

type Phase = 'data' | 'empty' | 'loading' | 'retry' | 'gone' | 'final';

/** Which state a query is in; pure, so the table is testable without rendering. */
export function queryPhase(q: Pick<QueryLike<unknown>, 'data' | 'error' | 'isPending' | 'isError' | 'fetchStatus'>, opts: { slow: boolean; isEmpty?: (data: never) => boolean; hasGone: boolean; offline: boolean }): Phase {
  if (q.data !== undefined) return opts.isEmpty?.(q.data as never) ? 'empty' : 'data';
  if (q.isError) {
    const c = classifyError(q.error);
    if (c.transient) return 'retry';
    const status = (q.error as { data?: { httpStatus?: unknown } } | null)?.data?.httpStatus;
    if (opts.hasGone && (status === 404 || status === 403 || c.code === 'not_found' || c.code === 'forbidden')) return 'gone';
    return 'final';
  }
  // Waiting for a network that isn't there: say so now rather than after the skeleton timeout.
  if (q.fetchStatus === 'paused' || opts.offline) return 'retry';
  return opts.slow ? 'retry' : 'loading';
}

/**
 * The one way a screen shows a query (audit pattern `skeleton_forever_error_states`): the screen's
 * skeleton while it loads, never forever (after `slowMs` it turns into a retry); offline says so at
 * once; a failure the network or our server caused keeps any data already on screen with a
 * "shown from last time" note and retries in the background; a final answer shows in plain words; an
 * empty result is an invitation to act. It only composes the shared `Skeleton` (the screen's),
 * `RetryState`, `EmptyState` and `StaleNote`; the connection strip itself stays in the app's root.
 */
export function QueryBoundary<T>({
  query,
  children,
  skeleton,
  isEmpty,
  empty,
  gone,
  retry,
  offlineArt,
  staleNote = true,
  slowMs,
  locale,
  testID = 'query',
  style,
}: QueryBoundaryProps<T>) {
  const theme = useTheme();
  const net = useNetwork();
  const waiting = query.data === undefined && query.isPending;
  const [slow, restartSlow] = useLoadTimeout(waiting, slowMs);
  const phase = queryPhase(query, { slow, isEmpty: isEmpty as ((d: never) => boolean) | undefined, hasGone: Boolean(gone), offline: net.state === 'offline' && waiting });

  const again = () => {
    restartSlow();
    if (net.state === 'unreachable') getNetwork().retryNow();
    void query.refetch();
  };

  if (phase === 'data' || phase === 'empty') {
    // Data kept from an earlier load while a refresh fails or the network is gone: mark it as old.
    const old = staleNote && (query.isError || !net.online);
    return (
      <View testID={`${testID}-${phase}`} style={[{ flexGrow: 1 }, style]}>
        {old ? <StaleNote updatedAt={query.dataUpdatedAt ?? null} force locale={locale} style={{ marginHorizontal: theme.space[4], marginTop: theme.space[2] }} /> : null}
        {phase === 'empty' && empty ? <EmptyState {...empty} /> : children(query.data as T)}
      </View>
    );
  }
  if (phase === 'loading') {
    return (
      <View testID={`${testID}-loading`} accessibilityLabel={sharedT('status.loading', undefined, locale)} accessibilityState={{ busy: true }} style={[{ flexGrow: 1 }, style]}>
        {skeleton}
      </View>
    );
  }
  if (phase === 'gone' && gone) {
    return (
      <View testID={`${testID}-gone`} style={[{ flexGrow: 1, justifyContent: 'center' }, style]}>
        <EmptyState icon={gone.icon} title={gone.title} body={gone.body} action={gone.action} />
      </View>
    );
  }
  if (phase === 'final') {
    // The server's own words for what happened ("ما لگينا المطلوب"), and a way to try again.
    const words = finalWords(query.error, locale);
    return (
      <View testID={`${testID}-final`} style={[{ flexGrow: 1, justifyContent: 'center' }, style]}>
        <RetryState kind="server" testID={`${testID}-retry`} title={words ?? retry?.server?.title} body={words ? null : retry?.server?.body} locale={locale} onRetry={again} />
      </View>
    );
  }
  // No error yet (still loading, or waiting for the network): offline / unreachable / slow. An error: whose it was.
  const kind = retryKindFor({ net, error: query.isError ? query.error : undefined, slow: !query.isError });
  const copy = retry?.[kind];
  const art = copy?.art ?? (kind === 'offline' || kind === 'unreachable' ? offlineArt : undefined);
  return (
    <View testID={`${testID}-error`} style={[{ flexGrow: 1, justifyContent: 'center' }, style]}>
      <RetryState kind={kind} testID={`${testID}-retry`} title={copy?.title} body={copy?.body} art={art} locale={locale} onRetry={again} />
    </View>
  );
}

function finalWords(err: unknown, locale?: Locale): string | null {
  const data = (err as { data?: { message_ar?: unknown; message_en?: unknown } } | null)?.data;
  const msg = locale === 'en' ? data?.message_en : data?.message_ar;
  return typeof msg === 'string' && msg ? msg : null;
}
