'use client';

import dynamic from 'next/dynamic';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { safeDecode } from '@/lib/format';
import { stepIndex, useHotkeys } from '@/lib/hotkeys';
import { CITY_ID, queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { readJson, writeJson } from '@/lib/prefs';
import { useSignedIn } from '@/lib/session';
import { setSupportView, useNewTicketRequests, useSupportView } from '@/lib/support-store';
import {
  filterQueue,
  markSeen,
  SEEN_KEY,
  SUPPORT_VIEWS,
  viewCounts,
  type SeenMap,
} from '@/lib/support-views';
import { useTRPC } from '@/lib/trpc';
import {
  EmptyState,
  IconButton,
  IconInbox,
  IconUser,
  LiveBadge,
  NeedLogin,
  QueryError,
  Sheet,
  Skeleton,
  useSecondsSince,
} from '../ui';
import type { ActionPrefill } from './actions';
import { ContextPane, type SupportAction } from './context';
import { Conversation, type CannedIntent, type ComposerHandle } from './conversation';
import { SupportQueue } from './queue';

const POLL_MS = 10_000;

// The refund, fault, escalate and resolve dialogs load the first time one opens (speed budget).
const SupportActionDialogs = dynamic(() => import('./actions').then((m) => m.SupportActionDialogs), {
  ssr: false,
});
// «قضية جديدة» loads the first time it opens too.
const NewTicketDialog = dynamic(() => import('./new-ticket').then((m) => m.NewTicketDialog), { ssr: false });

/**
 * The support desk (flagship): queue · conversation · context, one screen, keyboard first.
 * Mounted once by app/support/layout.tsx so the queue keeps its scroll and search while tickets
 * change under /support/[id]. Every action is the `support.*` router's; nothing is computed here
 * that the server decides (limits, money, SLA).
 */
export function SupportDesk() {
  const trpc = useTRPC();
  const router = useRouter();
  const params = useParams<{ id?: string }>();
  const ticketId = params?.id ? safeDecode(params.id) : null;
  const signedIn = useSignedIn();
  const { personId } = useMyRoles();
  const view = useSupportView();
  const [query, setQuery] = useState('');
  const [seen, setSeen] = useState<SeenMap>({});
  const [action, setAction] = useState<SupportAction | null>(null);
  const [prefill, setPrefill] = useState<ActionPrefill | null>(null);
  // Stays mounted once used, so a dialog can animate closed.
  const [actionsUsed, setActionsUsed] = useState(false);
  useEffect(() => {
    if (action) setActionsUsed(true);
  }, [action]);
  const [newTicket, setNewTicket] = useState(false);
  const [contextSheet, setContextSheet] = useState(false);
  const composer = useRef<ComposerHandle>(null);

  useEffect(() => setSeen(readJson<SeenMap>(SEEN_KEY, {})), []);
  const requests = useNewTicketRequests();
  useEffect(() => {
    if (requests > 0) setNewTicket(true);
  }, [requests]);

  const active = useQuery(
    trpc.support.list.queryOptions(
      { cityId: CITY_ID, status: 'active' },
      { enabled: signedIn, refetchInterval: POLL_MS, retry: queryRetry },
    ),
  );
  const resolved = useQuery(
    trpc.support.list.queryOptions(
      { cityId: CITY_ID, status: 'resolved' },
      { enabled: signedIn && view === 'resolved', refetchInterval: POLL_MS * 3, retry: queryRetry },
    ),
  );
  const source = view === 'resolved' ? resolved : active;
  const rows = useMemo(
    () => filterQueue(source.data?.rows ?? [], view, personId, query),
    [source.data, view, personId, query],
  );
  const counts = useMemo(
    () => (active.data ? viewCounts(active.data.rows, personId) : null),
    [active.data, personId],
  );

  const tick = useSecondsSince(active.dataUpdatedAt);
  const now = useMemo(
    () => new Date((active.data?.at.getTime() ?? Date.now()) + tick * 1000),
    [active.data, tick],
  );

  const kase = useQuery(
    trpc.support.get.queryOptions(
      { ticketId: ticketId ?? '' },
      { enabled: signedIn && Boolean(ticketId), refetchInterval: POLL_MS, retry: queryRetry },
    ),
  );
  const customer = useQuery(
    trpc.support.customer.queryOptions(
      { ticketId: ticketId ?? '' },
      { enabled: signedIn && Boolean(ticketId), retry: queryRetry, staleTime: 30_000 },
    ),
  );

  // Open the first ticket when the desk opens on /support (desktop), like an inbox.
  const opened = useRef(false);
  useEffect(() => {
    if (
      opened.current ||
      ticketId ||
      !rows[0] ||
      typeof window === 'undefined' ||
      window.innerWidth < 1024
    )
      return;
    opened.current = true;
    router.replace(`/support/${encodeURIComponent(rows[0].id)}`);
  }, [rows, ticketId, router]);

  // Mark the open ticket as read (per browser).
  const openRow = kase.data?.ticket;
  useEffect(() => {
    if (!openRow) return;
    setSeen((s) => {
      const next = markSeen(s, openRow);
      writeJson(SEEN_KEY, next);
      return next;
    });
  }, [openRow?.id, openRow?.lastActivityAt.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps -- by identity of the activity

  useEffect(() => {
    setAction(null);
    setPrefill(null);
  }, [ticketId]);

  const select = (id: string) => router.push(`/support/${encodeURIComponent(id)}`);
  const move = (d: 1 | -1) => {
    const i = rows.findIndex((r) => r.id === ticketId);
    const next = rows[stepIndex(i, rows.length, d)];
    if (next) select(next.id);
  };
  const closed = kase.data?.ticket.status === 'resolved';
  const dialogsOpen = action !== null || newTicket;
  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      e: () => kase.data && !closed && setAction('resolve'),
      r: () => kase.data && !closed && composer.current?.focus('reply'),
      n: () => kase.data && !closed && composer.current?.focus('note'),
      ...Object.fromEntries(SUPPORT_VIEWS.map((v, i) => [String(i + 1), () => setSupportView(v)])),
    },
    { enabled: signedIn && !dialogsOpen },
  );

  const onCanned = (c: CannedIntent) => {
    if (c.action === 'refund') setPrefill({ amountIqd: c.amountIqd });
    else if (c.action === 'fault_courier') setPrefill({ fault: 'courier', amountIqd: c.amountIqd });
    else if (c.action === 'fault_merchant')
      setPrefill({ fault: 'merchant', amountIqd: c.amountIqd });
    else setPrefill(null);
  };

  if (!signedIn) {
    return (
      <div className="p-8">
        <NeedLogin />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(280px,340px)_minmax(0,1fr)] min-[1200px]:grid-cols-[340px_minmax(0,1fr)_320px]">
      <div className={ticketId ? 'hidden min-h-0 md:block' : 'min-h-0'}>
        {active.error && !active.data ? (
          <div className="p-4">
            <QueryError error={active.error} onRetry={() => void active.refetch()} />
          </div>
        ) : (
          <SupportQueue
            rows={rows}
            counts={counts}
            view={view}
            onView={setSupportView}
            query={query}
            onQuery={setQuery}
            selectedId={ticketId}
            onSelect={select}
            onNew={() => setNewTicket(true)}
            now={now}
            seen={seen}
            loading={source.isPending}
            live={
              <LiveBadge
                seconds={POLL_MS / 1000}
                updatedAt={active.dataUpdatedAt}
                fetching={active.isFetching}
                error={Boolean(active.error)}
                compact
              />
            }
          />
        )}
      </div>

      <div className={ticketId ? 'min-h-0 min-w-0' : 'hidden min-h-0 md:block'}>
        {!ticketId ? (
          <div className="flex h-full items-center justify-center bg-canvas p-8">
            <EmptyState
              bare
              icon={<IconInbox size={20} />}
              title={t('console.sup_pick')}
              hint={t('console.sup_pick_hint')}
            />
          </div>
        ) : kase.error && !kase.data ? (
          <div className="p-6">
            <QueryError error={kase.error} onRetry={() => void kase.refetch()} />
          </div>
        ) : kase.data ? (
          <Conversation
            data={kase.data}
            now={now}
            composerRef={composer}
            onCanned={onCanned}
            headerExtra={
              <span className="min-[1200px]:hidden">
                <IconButton
                  label={t('console.sup_customer')}
                  variant="secondary"
                  size="sm"
                  onClick={() => setContextSheet(true)}
                >
                  <IconUser size={16} />
                </IconButton>
              </span>
            }
          />
        ) : (
          <ConversationSkeleton />
        )}
      </div>

      <div className="hidden min-h-0 min-[1200px]:block">
        {kase.data ? (
          <ContextPane
            data={kase.data}
            customer={customer.data}
            customerLoading={customer.isPending}
            customerError={customer.isError}
            onAction={setAction}
          />
        ) : (
          <div className="h-full border-s border-line bg-surface" />
        )}
      </div>

      {kase.data ? (
        <>
          {action || actionsUsed ? (
            <SupportActionDialogs
              data={kase.data}
              open={action}
              onClose={() => setAction(null)}
              prefill={prefill}
            />
          ) : null}
          <Sheet
            open={contextSheet}
            onClose={() => setContextSheet(false)}
            title={t('console.sup_customer')}
            width="22rem"
          >
            <div className="-mx-5 -my-4">
              <ContextPane
                data={kase.data}
                customer={customer.data}
                customerLoading={customer.isPending}
                customerError={customer.isError}
                onAction={(a) => {
                  setContextSheet(false);
                  setAction(a);
                }}
              />
            </div>
          </Sheet>
        </>
      ) : null}
      {newTicket ? <NewTicketDialog open onClose={() => setNewTicket(false)} /> : null}
    </div>
  );
}

function ConversationSkeleton() {
  return (
    <div className="flex h-full flex-col bg-canvas">
      <div className="space-y-2 border-b border-line bg-surface px-6 py-5">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-3.5 w-1/3" />
      </div>
      <div className="flex-1 space-y-4 px-6 py-6">
        <Skeleton className="h-16 w-2/3 rounded-xl" />
        <Skeleton className="ms-auto h-12 w-1/2 rounded-xl" />
      </div>
    </div>
  );
}
