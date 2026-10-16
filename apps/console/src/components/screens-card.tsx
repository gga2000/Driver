'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScreenAudience, ScreenSwitch, ScreenSwitchView } from '@driver/contracts';
import { t, type MessageKey } from '@driver/i18n';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { formatDayClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, cx, Dialog, Field, Input, QueryError, Segmented, Skeleton, useToast, type ChipTone } from './ui';

/**
 * Screen switches (W6, lane B's `ops.controls.screens`): the redesigned customer screens ship beside
 * today's, and each shows to nobody, to staff, or to every customer. Showing one is an admin's call;
 * any dispatcher can send everyone back to the old screen on a bad night. Apps pick a change up at
 * their next start, never in the middle of an order.
 */
const SCREEN_KEY = {
  basket_v2: 'console.screens_basket_v2',
  checkout_v2: 'console.screens_checkout_v2',
  track_v2: 'console.screens_track_v2',
  orders_v2: 'console.screens_orders_v2',
} as const satisfies Record<ScreenSwitch, MessageKey>;
const AUDIENCE_KEY = {
  off: 'console.screens_aud_off',
  staff: 'console.screens_aud_staff',
  all: 'console.screens_aud_all',
} as const satisfies Record<ScreenAudience, MessageKey>;
const STATE_KEY = {
  off: 'console.screens_state_off',
  staff: 'console.screens_state_staff',
  all: 'console.screens_state_all',
} as const satisfies Record<ScreenAudience, MessageKey>;
const AUDIENCE_TONE: Record<ScreenAudience, ChipTone> = { off: 'neutral', staff: 'warn', all: 'live' };
const AUDIENCES: readonly ScreenAudience[] = ['off', 'staff', 'all'];

interface Change {
  row: ScreenSwitchView;
  to: ScreenAudience;
}

export function ScreensCard({
  signedIn,
  canShow,
  canOff,
}: {
  signedIn: boolean;
  /** Admin: may show a new screen to staff or everyone. */
  canShow: boolean;
  /** Admin or dispatcher: may send everyone back to the old screen. */
  canOff: boolean;
}) {
  const trpc = useTRPC();
  const list = useQuery(trpc.ops.controls.screens.queryOptions({ cityId: CITY_ID }, { enabled: signedIn, refetchInterval: 30_000, retry: queryRetry }));
  const [change, setChange] = useState<Change | null>(null);
  return (
    <Card
      title={t('console.screens_title')}
      hint={t('console.screens_hint')}
      actions={!canOff ? <Chip>{t('console.ctl_read_only')}</Chip> : !canShow ? <Chip>{t('console.screens_off_only')}</Chip> : undefined}
    >
      {list.error && !list.data ? (
        <QueryError error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data ? (
        <div className="space-y-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : (
        <ScreensList rows={list.data} canShow={canShow} canOff={canOff} onChange={(row, to) => setChange({ row, to })} />
      )}
      <ScreenDialog change={change} onClose={() => setChange(null)} />
    </Card>
  );
}

/** The four rows from data (smoke-tested without a server). */
export function ScreensList({
  rows,
  canShow,
  canOff,
  onChange,
}: {
  rows: ScreenSwitchView[];
  canShow: boolean;
  canOff: boolean;
  onChange: (row: ScreenSwitchView, to: ScreenAudience) => void;
}) {
  return (
    <ul className="divide-y divide-line" data-testid="screens-list">
      {rows.map((s) => {
        const name = t(SCREEN_KEY[s.key]);
        return (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0" data-testid={`screen-${s.key}`}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {name}
                <Chip tone={AUDIENCE_TONE[s.audience]} size="sm" dot={s.audience !== 'off'}>
                  {t(AUDIENCE_KEY[s.audience])}
                </Chip>
              </p>
              <p className="mt-0.5 text-xs text-muted">{t(STATE_KEY[s.audience])}</p>
              {s.setAt && s.reason ? (
                <p className="mt-0.5 text-xs text-muted">
                  <span className="num">{t('console.screens_set_by', { name: s.setByName ?? t('console.someone'), time: formatDayClock(s.setAt) })}</span>
                  {': '}
                  <span className="text-text">{s.reason}</span>
                </p>
              ) : null}
            </div>
            {canShow ? (
              <Segmented<ScreenAudience>
                size="sm"
                label={t('console.screens_for', { name })}
                value={s.audience}
                onChange={(to) => to !== s.audience && onChange(s, to)}
                options={AUDIENCES.map((a) => ({ value: a, label: t(AUDIENCE_KEY[a]) }))}
              />
            ) : canOff && s.audience !== 'off' ? (
              <Button size="sm" variant="danger-soft" onClick={() => onChange(s, 'off')} data-testid={`screen-off-${s.key}`}>
                {t('console.screens_back_old')}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ScreenDialog({ change, onClose }: { change: Change | null; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const save = useMutation(
    trpc.ops.controls.setScreen.mutationOptions({
      onSuccess: (s) => {
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.screens.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
        toast({ title: t('console.screens_saved', { name: t(SCREEN_KEY[s.key]), who: t(AUDIENCE_KEY[s.audience]) }), tone: 'ok' });
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
  const name = change ? t(SCREEN_KEY[change.row.key]) : '';
  const off = change?.to === 'off';
  const valid = reason.trim().length >= 3;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!change || !valid) return;
    save.mutate({ cityId: CITY_ID, key: change.row.key, audience: change.to, reason: reason.trim() });
  };
  return (
    <Dialog
      open={change !== null}
      onClose={onClose}
      labelledBy="screen-title"
      width="sm"
      title={change ? (off ? t('console.screens_dialog_off', { name }) : t('console.screens_dialog_show', { name, who: t(AUDIENCE_KEY[change.to]) })) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('console.cancel')}
          </Button>
          <Button variant={off ? 'danger' : 'primary'} needsNet disabled={!valid} loading={save.isPending} onClick={() => submit()}>
            {off ? t('console.screens_back_old') : t('console.screens_do_show', { who: change ? t(AUDIENCE_KEY[change.to]) : '' })}
          </Button>
        </>
      }
    >
      {change && (
        <form onSubmit={submit} className="space-y-4 pb-1">
          <p className={cx('rounded-md border px-3 py-2.5 text-sm', off ? 'border-line bg-surface-2' : 'border-warn-solid/40 bg-warn-tint')}>
            {t(off ? 'console.screens_explain_off' : change.to === 'staff' ? 'console.screens_explain_staff' : 'console.screens_explain_all')}
          </p>
          <Field label={t('console.ctl_reason')} htmlFor={reasonId} hint={t('console.screens_reason_hint')}>
            <Input
              id={reasonId}
              required
              minLength={3}
              maxLength={300}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t(off ? 'console.screens_reason_off_ph' : 'console.screens_reason_show_ph')}
            />
          </Field>
          <p className="text-xs text-muted">{t('console.screens_next_start')}</p>
          <div role="status" className="min-h-[1.25rem] text-sm">
            {save.error && <p className="text-bad">{errorText(save.error)}</p>}
          </div>
        </form>
      )}
    </Dialog>
  );
}
