'use client';

import { useQuery } from '@tanstack/react-query';
import { columnOf } from './board';
import { CITY_ID, queryRetry } from './live';
import { hasAny, useMyRoles } from './me';
import { NAV } from './nav';
import { useSignedIn } from './session';
import { useTRPC } from './trpc';

/**
 * Live counts for the sidebar badges (K-05): cards that need a dispatcher, open tickets (red when
 * any is overdue), items waiting for approval. Each read only runs for roles that may make it, and
 * shares its cache with the page that shows the same list.
 */
export interface NavCounts {
  '/dispatch'?: { n: number; alert: boolean };
  '/support'?: { n: number; alert: boolean };
  '/approvals'?: { n: number; alert: boolean };
}

const POLL = 15_000;
const rolesOf = (href: string) => NAV.find((i) => i.href === href)!.roles;

export function useNavCounts(): NavCounts {
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const can = (href: string) => signedIn && loaded && hasAny(roles, rolesOf(href));
  const board = useQuery(
    trpc.dispatch.board.queryOptions(
      { cityId: CITY_ID },
      { enabled: can('/dispatch'), refetchInterval: POLL, retry: queryRetry },
    ),
  );
  const support = useQuery(
    trpc.support.list.queryOptions(
      { cityId: CITY_ID, status: 'active' },
      { enabled: can('/support'), refetchInterval: POLL, retry: queryRetry },
    ),
  );
  const approvals = useQuery(
    trpc.approvals.list.queryOptions(
      { cityId: CITY_ID },
      { enabled: can('/approvals'), refetchInterval: POLL * 2, retry: queryRetry },
    ),
  );
  const out: NavCounts = {};
  if (board.data) {
    const n = board.data.cards.filter((c) => columnOf(c) === 'needs_dispatcher').length;
    out['/dispatch'] = { n, alert: n > 0 };
  }
  if (support.data)
    out['/support'] = { n: support.data.counts.open, alert: support.data.counts.breached > 0 };
  if (approvals.data) out['/approvals'] = { n: approvals.data.items.length, alert: false };
  return out;
}
