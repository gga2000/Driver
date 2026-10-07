import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Text } from 'react-native';
import { RequestTimeoutError } from '@driver/contracts/net-client';
import { getNetwork } from '../network/network';
import { renderUI } from '../test/render';
import { QueryBoundary, queryPhase, type QueryLike } from './QueryBoundary';

const answered = (httpStatus: number, code: string, message_ar = 'ما لگينا المطلوب') => Object.assign(new Error(code), { data: { httpStatus, code, message_ar, message_en: 'Not found' } });

function q<T>(over: Partial<QueryLike<T>>): QueryLike<T> {
  return { data: undefined, error: null, isPending: false, isError: false, fetchStatus: 'idle', refetch: vi.fn(), ...over };
}

const base = { slow: false, hasGone: false, offline: false };

describe('queryPhase: which state a screen is in', () => {
  it.each([
    ['first load', q({ isPending: true, fetchStatus: 'fetching' }), base, 'loading'],
    ['first load past the skeleton timeout', q({ isPending: true, fetchStatus: 'fetching' }), { ...base, slow: true }, 'retry'],
    ['waiting for the network', q({ isPending: true, fetchStatus: 'paused' }), base, 'retry'],
    ['the device is offline', q({ isPending: true }), { ...base, offline: true }, 'retry'],
    ['no response', q({ isError: true, error: new RequestTimeoutError(15_000) }), base, 'retry'],
    ['our server failed', q({ isError: true, error: answered(500, 'internal') }), base, 'retry'],
    ['not found, with a gone state', q({ isError: true, error: answered(404, 'not_found') }), { ...base, hasGone: true }, 'gone'],
    ['not found, without one', q({ isError: true, error: answered(404, 'not_found') }), base, 'final'],
    ['a rule said no', q({ isError: true, error: answered(409, 'store_closed') }), { ...base, hasGone: true }, 'final'],
    ['data', q({ data: [1] }), base, 'data'],
    ['data kept while a refresh fails', q({ data: [1], isError: true, error: answered(500, 'internal') }), base, 'data'],
  ] as const)('%s → %s', (_label, query, opts, phase) => {
    expect(queryPhase(query, opts)).toBe(phase);
  });

  it('empty data is the empty state', () => {
    expect(queryPhase(q({ data: [] as number[] }), { ...base, isEmpty: (d: number[]) => d.length === 0 })).toBe('empty');
  });
});

describe('QueryBoundary', () => {
  afterEach(() => {
    vi.useRealTimers();
    act(() => getNetwork().setDeviceOnline(true));
  });

  const render = (query: QueryLike<string[]>, extra: Partial<Parameters<typeof QueryBoundary<string[]>>[0]> = {}) =>
    renderUI(
      <QueryBoundary query={query} skeleton={<Text testID="skel">…</Text>} {...extra}>
        {(rows) => <Text testID="rows">{rows.join(',')}</Text>}
      </QueryBoundary>,
    );

  it('shows the skeleton, then never forever: a retry after the timeout', () => {
    vi.useFakeTimers();
    const query = q<string[]>({ isPending: true, fetchStatus: 'fetching' });
    render(query, { slowMs: 8_000 });
    expect(screen.getByTestId('skel')).toBeTruthy();
    act(() => vi.advanceTimersByTime(8_000));
    expect(screen.getByTestId('query-retry-slow')).toBeTruthy();
    fireEvent.click(screen.getByTestId('query-retry-retry'));
    expect(query.refetch).toHaveBeenCalledTimes(1);
    // Retrying starts the clock again: the skeleton is back while the request is out.
    expect(screen.getByTestId('skel')).toBeTruthy();
  });

  it('offline with nothing to show says so at once', () => {
    act(() => getNetwork().setDeviceOnline(false));
    render(q({ isPending: true, fetchStatus: 'paused' }));
    expect(screen.getByTestId('query-retry-offline')).toBeTruthy();
  });

  it('keeps the data on screen when a refresh fails, marked as old', () => {
    render(q({ data: ['كباب'], isError: true, error: answered(500, 'internal'), dataUpdatedAt: Date.now() - 120_000 }));
    expect(screen.getByTestId('rows').textContent).toBe('كباب');
    expect(screen.getByTestId('stale-note')).toBeTruthy();
  });

  it('no note while fresh data is on screen', () => {
    render(q({ data: ['كباب'], dataUpdatedAt: Date.now() }));
    expect(screen.queryByTestId('stale-note')).toBeNull();
  });

  it('a server failure with nothing to show offers a retry', () => {
    const query = q<string[]>({ isError: true, error: answered(500, 'internal') });
    render(query);
    expect(screen.getByTestId('query-retry-server')).toBeTruthy();
    fireEvent.click(screen.getByTestId('query-retry-retry'));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it("a final answer shows the server's own words", () => {
    render(q({ isError: true, error: answered(409, 'store_closed', 'المطعم مسكّر هسه') }));
    expect(screen.getByTestId('query-final').textContent).toContain('المطعم مسكّر هسه');
    expect(screen.getByTestId('query-final').textContent).not.toContain('دنصلّحها');
  });

  it('not found uses the screen\'s gone state', () => {
    render(q({ isError: true, error: answered(404, 'not_found') }), { gone: { icon: 'receipt', title: 'هذا الطلب مو موجود' } });
    expect(screen.getByTestId('query-gone').textContent).toContain('هذا الطلب مو موجود');
  });

  it('an empty result is an invitation to act', () => {
    const onPress = vi.fn();
    render(q({ data: [] }), { isEmpty: (d) => d.length === 0, empty: { icon: 'receipt', title: 'بعدك ما طلبت', action: { label: 'اطلب هسه', onPress } } });
    expect(screen.getByTestId('query-empty').textContent).toContain('بعدك ما طلبت');
    fireEvent.click(screen.getByText('اطلب هسه'));
    expect(onPress).toHaveBeenCalled();
  });
});
