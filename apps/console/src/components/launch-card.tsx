'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LaunchSwitch, LaunchSwitchView } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, Field, Input, QueryError, Skeleton, useToast } from './ui';

/**
 * Opening a new service (Ali 2026-10-12: "add an option to open and close them in the console"):
 * services that live inside a launched vertical, food carts first, open to customers or close here.
 * Opening is an admin's call; any controller may close one on a bad night. The server reads the
 * switch every couple of seconds; the apps see it at their next refresh, within a minute.
 */
const LAUNCH_KEY = { food_carts: 'console.launch_food_carts' } as const satisfies Record<LaunchSwitch, MessageKey>;
const LAUNCH_ABOUT_KEY = { food_carts: 'console.launch_food_carts_about' } as const satisfies Record<LaunchSwitch, MessageKey>;

interface Change {
  row: LaunchSwitchView;
  open: boolean;
}

export function LaunchCard({
  signedIn,
  canOpen,
  canClose,
}: {
  signedIn: boolean;
  /** Admin: may open a service to customers. */
  canOpen: boolean;
  /** Admin or dispatcher: may close it. */
  canClose: boolean;
}) {
  const trpc = useTRPC();
  const list = useQuery(trpc.ops.controls.launches.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: 30_000, retry: queryRetry }));
  const [change, setChange] = useState<Change | null>(null);
  return (
    <Card
      title={t('console.launch_title')}
      hint={t('console.launch_hint')}
      actions={!canClose ? <Chip>{t('console.ctl_read_only')}</Chip> : !canOpen ? <Chip>{t('console.launch_close_only')}</Chip> : undefined}
    >
      {list.error && !list.data ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="space-y-2" aria-busy>
          <Skeleton className="h-14" />
        </div>
      ) : (
        <LaunchList rows={list.data} canOpen={canOpen} canClose={canClose} onChange={(row, open) => setChange({ row, open })} />
      )}
      <LaunchDialog change={change} onClose={() => setChange(null)} />
    </Card>
  );
}

/** The rows from data (smoke-tested without a server). */
export function LaunchList({
  rows,
  canOpen,
  canClose,
  onChange,
}: {
  rows: LaunchSwitchView[];
  canOpen: boolean;
  canClose: boolean;
  onChange: (row: LaunchSwitchView, open: boolean) => void;
}) {
  return (
    <ul className="divide-y divide-line" data-testid="launch-list">
      {rows.map((s) => {
        const name = t(LAUNCH_KEY[s.key]);
        return (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid={`launch-${s.key}`}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {name}
                <Chip tone={s.open ? 'live' : 'neutral'} size="sm" dot={s.open}>
                  {t(s.open ? 'console.launch_open' : 'console.launch_closed')}
                </Chip>
              </p>
              <p className="mt-0.5 text-xs text-muted">{t(LAUNCH_ABOUT_KEY[s.key])}</p>
              {s.setAt && s.reason ? (
                <p className="mt-0.5 text-xs text-muted">
                  <span className="num">{t('console.launch_set_by', { name: s.setByName ?? t('console.someone'), time: formatDayClock(s.setAt) })}</span>
                  {': '}
                  <span className="text-text">{s.reason}</span>
                </p>
              ) : s.fromDefault ? (
                <p className="mt-0.5 text-xs text-muted">{t('console.launch_from_default')}</p>
              ) : null}
            </div>
            {s.open && canClose ? (
              <Button size="sm" variant="danger-soft" onClick={() => onChange(s, false)} data-testid={`launch-close-${s.key}`}>
                {t('console.launch_do_close')}
              </Button>
            ) : !s.open && canOpen ? (
              <Button size="sm" variant="primary" onClick={() => onChange(s, true)} data-testid={`launch-open-${s.key}`}>
                {t('console.launch_do_open')}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function LaunchDialog({ change, onClose }: { change: Change | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const save = useMutation(
    trpc.ops.controls.setLaunch.mutationOptions({
      onSuccess: (s) => {
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.launches.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        toast({ title: t(s.open ? 'console.launch_saved_open' : 'console.launch_saved_closed', { name: t(LAUNCH_KEY[s.key]) }), tone: 'ok' });
        onClose();
      },
    }),
  );
  useEffect(() => {
    if (!change) return;
    setReason('');
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on a new change only
  }, [change]);
  const name = change ? t(LAUNCH_KEY[change.row.key]) : '';
  const opening = change?.open === true;
  const valid = reason.trim().length >= 3;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!change || !valid) return;
    save.mutate({ cityId: CITY_ID, key: change.row.key, open: change.open, reason: reason.trim() });
  };
  return (
    <Dialog
      open={change !== null}
      onClose={onClose}
      labelledBy="launch-title"
      width="sm"
      title={change ? t(opening ? 'console.launch_dialog_open' : 'console.launch_dialog_close', { name }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant={opening ? 'primary' : 'danger'} needsNet disabled={!valid} loading={save.isPending} onClick={() => submit()}>
            {t(opening ? 'console.launch_do_open' : 'console.launch_do_close')}
          </Button>
        </>
      }
    >
      {change && (
        <form onSubmit={submit} className="space-y-4 pb-1">
          <p className={cx('rounded-md border px-3 py-2.5 text-sm', opening ? 'border-warn-solid/40 bg-warn-tint' : 'border-line bg-surface-2')}>
            {t(opening ? 'console.launch_explain_open' : 'console.launch_explain_close')}
          </p>
          <Field label={t('console.ctl_reason')} htmlFor={reasonId} hint={t('console.launch_reason_hint')}>
            <Input
              id={reasonId}
              required
              minLength={3}
              maxLength={300}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(opening ? 'console.launch_reason_open_ph' : 'console.launch_reason_close_ph')}
            />
          </Field>
          <p className="text-xs text-muted">{t('console.launch_timing')}</p>
          <div role="status" className="min-h-[1.25rem] text-sm">
            {save.error && <p className="text-bad">{errorText(save.error)}</p>}
          </div>
        </form>
      )}
    </Dialog>
  );
}
