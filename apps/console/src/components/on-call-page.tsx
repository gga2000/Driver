'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ON_CALL_EDIT_ROLES,
  ON_CALL_RULES,
  type OnCallDesk,
  type OnCallNow,
  type OnCallShiftRow,
} from '@driver/contracts';
import { t } from '@driver/i18n';
import { useId, useState } from 'react';
import { formatClock } from '@/lib/format';
import { CITY_ID, queryRetry } from '@/lib/live';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import {
  cityToday,
  DESK_KEY,
  PRESET_KEY,
  RANK_KEY,
  SHIFT_PRESETS,
  shiftSpan,
  shiftState,
  shiftWindow,
  STATE_KEY,
  STATE_TONE,
  type ShiftPreset,
} from '@/lib/on-call';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import {
  Button,
  Card,
  Chip,
  DataTable,
  Dialog,
  Field,
  IconAlert,
  Input,
  NeedLogin,
  PageHeader,
  QueryError,
  Segmented,
  Select,
  SkeletonBlock,
  useToast,
  type Column,
} from './ui';

const DESKS: readonly OnCallDesk[] = ['sos', 'cash'];

/**
 * Console › المناوبة (E1, CON-02 and G0-9): who is reached when an alert reaches nobody. The top shows
 * who is on call right now per desk (red when nobody is: the admins get it instead), then how an SOS
 * climbs (the rules come from the server's `ON_CALL_RULES`), then the week's roster. Admins add and
 * remove shifts (`onCall.add/end`, audited); every staff desk can read it.
 */
export function OnCallPage() {
  const signedIn = useSignedIn();
  const { roles, loaded } = useMyRoles();
  const canEdit = loaded && hasAny(roles, ON_CALL_EDIT_ROLES);
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title={t('console.oncall_title')} subtitle={t('console.oncall_subtitle')} />
      {!signedIn ? (
        <NeedLogin />
      ) : (
        <div className="space-y-5">
          <NowCards />
          <Ladder />
          <div
            className={canEdit ? 'grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]' : ''}
          >
            <Roster canEdit={canEdit} />
            {canEdit ? <AddShift /> : null}
          </div>
          {loaded && !canEdit ? (
            <p className="text-dense text-muted">{t('console.oncall_admins_only')}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── who is on call now ─────────────────────────

function NowCards() {
  const trpc = useTRPC();
  const now = useQuery(
    trpc.onCall.now.queryOptions(
      { cityId: CITY_ID },
      { retry: queryRetry, refetchInterval: 60_000 },
    ),
  );
  if (now.isError) return <QueryError error={now.error} onRetry={() => void now.refetch()} />;
  if (!now.data)
    return (
      <div className="grid gap-5 md:grid-cols-2">
        <SkeletonBlock className="h-[132px]" />
        <SkeletonBlock className="h-[132px]" />
      </div>
    );
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {DESKS.map((desk) => {
        const d = now.data.find((x) => x.desk === desk);
        return d ? <NowCard key={desk} desk={d} /> : null;
      })}
    </div>
  );
}

function NowCard({ desk }: { desk: OnCallNow }) {
  const title = t('console.oncall_now_title', { desk: t(DESK_KEY[desk.desk]) });
  if (desk.fallbackToAdmins) {
    return (
      <Card title={title} tone="bad">
        <div className="flex items-start gap-3">
          <IconAlert size={20} className="mt-0.5 shrink-0 text-bad" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{t('console.oncall_nobody')}</p>
            <p className="mt-0.5 text-dense text-muted">
              {t(desk.desk === 'sos' ? 'console.oncall_nobody_sos' : 'console.oncall_nobody_cash')}
            </p>
          </div>
        </div>
      </Card>
    );
  }
  return (
    <Card title={title} tone="ok">
      <ul className="space-y-2">
        {desk.people.map((p) => (
          <li
            key={`${p.personId}-${p.rank}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1"
          >
            <Chip tone={p.rank === 1 ? 'live' : 'neutral'} size="sm">
              {t(RANK_KEY[p.rank] ?? 'console.oncall_rank_2')}
            </Chip>
            <span className="text-sm font-semibold text-text">
              {p.displayName ?? t('console.oncall_no_name')}
            </span>
            <span className="num text-dense text-muted">
              {t('console.oncall_until', { time: formatClock(p.until) })}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────────────────────── how an SOS climbs ─────────────────────────

function Ladder() {
  const steps = [
    { at: 0, key: 'console.oncall_step_0' as const },
    { at: ON_CALL_RULES.ringEverySec, key: 'console.oncall_step_ring' as const },
    { at: ON_CALL_RULES.onCallAfterSec, key: 'console.oncall_step_1' as const },
    { at: ON_CALL_RULES.nextRankAfterSec, key: 'console.oncall_step_2' as const },
  ];
  return (
    <Card
      title={t('console.oncall_ladder_title')}
      hint={t('console.oncall_ladder_hint', {
        minutes: Math.round(ON_CALL_RULES.ringSlowAfterSec / 60),
      })}
    >
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.key} className="rounded-md border border-line bg-surface-2 p-3">
            <p className="num text-xs font-semibold text-accent-text">
              {s.at === 0
                ? t('console.oncall_at_start')
                : t('console.oncall_at_sec', { sec: s.at })}
            </p>
            <p className="mt-1 text-dense text-text">
              {t(s.key, { sec: ON_CALL_RULES.ringEverySec })}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted">{t('console.oncall_call_off')}</p>
    </Card>
  );
}

// ───────────────────────── the roster ─────────────────────────

function Roster({ canEdit }: { canEdit: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(
    trpc.onCall.list.queryOptions(
      { cityId: CITY_ID },
      { retry: queryRetry, refetchInterval: 60_000 },
    ),
  );
  const [removing, setRemoving] = useState<OnCallShiftRow | null>(null);
  const end = useMutation(
    trpc.onCall.end.mutationOptions({
      onSuccess: () => {
        toast({ title: t('console.oncall_removed'), tone: 'ok' });
        setRemoving(null);
        void qc.invalidateQueries({ queryKey: trpc.onCall.list.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.onCall.now.queryKey() });
      },
      onError: (e) =>
        toast({ title: t('console.oncall_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  const now = new Date();
  const columns: Column<OnCallShiftRow>[] = [
    {
      key: 'when',
      header: t('console.oncall_col_when'),
      cell: (r) => <span className="num whitespace-nowrap">{shiftSpan(r.startsAt, r.endsAt)}</span>,
    },
    { key: 'desk', header: t('console.oncall_col_desk'), cell: (r) => t(DESK_KEY[r.desk]) },
    {
      key: 'who',
      header: t('console.oncall_col_who'),
      cell: (r) => (
        <span className="font-medium text-text">
          {r.displayName ?? t('console.oncall_no_name')}
        </span>
      ),
    },
    {
      key: 'rank',
      header: t('console.oncall_col_rank'),
      cell: (r) => t(RANK_KEY[r.rank] ?? 'console.oncall_rank_2'),
    },
    {
      key: 'state',
      header: t('console.oncall_col_state'),
      cell: (r) => {
        const s = shiftState(r, now);
        return (
          <Chip tone={STATE_TONE[s]} size="sm">
            {t(STATE_KEY[s])}
          </Chip>
        );
      },
    },
    ...(canEdit
      ? [
          {
            key: 'act',
            header: <span className="sr-only">{t('console.oncall_remove')}</span>,
            cell: (r: OnCallShiftRow) =>
              r.endedAt === null && r.endsAt.getTime() > now.getTime() ? (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(r)} needsNet>
                  {t('console.oncall_remove')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];
  return (
    <Card title={t('console.oncall_roster_title')} hint={t('console.oncall_roster_hint')} flush>
      {list.isError ? (
        <div className="p-5">
          <QueryError error={list.error} onRetry={() => void list.refetch()} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={list.data}
          rowKey={(r) => r.id}
          loading={list.isPending}
          caption={t('console.oncall_roster_title')}
          empty={{
            title: t('console.oncall_empty'),
            hint: canEdit ? t('console.oncall_empty_hint') : t('console.oncall_admins_only'),
          }}
        />
      )}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={t('console.oncall_remove_title')}
        description={
          removing
            ? t('console.oncall_remove_body', {
                name: removing.displayName ?? t('console.oncall_no_name'),
                desk: t(DESK_KEY[removing.desk]),
              })
            : undefined
        }
        width="sm"
        footer={
          <>
            <Button onClick={() => setRemoving(null)}>{t('console.cancel')}</Button>
            <Button
              variant="danger"
              loading={end.isPending}
              needsNet
              onClick={() => removing && end.mutate({ id: removing.id })}
            >
              {t('console.oncall_remove')}
            </Button>
          </>
        }
      >
        <p className="text-dense text-muted">{t('console.oncall_remove_note')}</p>
      </Dialog>
    </Card>
  );
}

// ───────────────────────── add a shift (admins) ─────────────────────────

function AddShift() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { person: useId(), day: useId() };
  const staff = useQuery(
    trpc.onCall.staff.queryOptions(undefined, { retry: queryRetry, staleTime: 5 * 60_000 }),
  );
  const [personId, setPersonId] = useState('');
  const [desk, setDesk] = useState<OnCallDesk>('sos');
  const [rank, setRank] = useState<'1' | '2'>('1');
  const [day, setDay] = useState(() => cityToday(new Date()));
  const [preset, setPreset] = useState<ShiftPreset>('evening');
  const slot = shiftWindow(day, preset);
  const add = useMutation(
    trpc.onCall.add.mutationOptions({
      onSuccess: (row) => {
        toast({
          title: t('console.oncall_added', {
            name: row.displayName ?? t('console.oncall_no_name'),
          }),
          tone: 'ok',
        });
        setPersonId('');
        void qc.invalidateQueries({ queryKey: trpc.onCall.list.queryKey() });
        void qc.invalidateQueries({ queryKey: trpc.onCall.now.queryKey() });
      },
      onError: (e) =>
        toast({ title: t('console.oncall_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  return (
    <Card title={t('console.oncall_add_title')}>
      {staff.isError ? (
        <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!personId || !slot) return;
            add.mutate({
              cityId: CITY_ID,
              desk,
              personId,
              rank: Number(rank),
              startsAt: slot.startsAt,
              endsAt: slot.endsAt,
            });
          }}
        >
          <Field label={t('console.oncall_col_who')} htmlFor={ids.person}>
            <Select
              id={ids.person}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
              disabled={!staff.data}
            >
              <option value="">
                {staff.data ? t('console.oncall_pick_person') : t('console.loading')}
              </option>
              {(staff.data ?? []).map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.displayName ?? t('console.oncall_no_name')}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('console.oncall_col_desk')}>
            <Segmented<OnCallDesk>
              label={t('console.oncall_col_desk')}
              value={desk}
              onChange={setDesk}
              options={DESKS.map((d) => ({ value: d, label: t(DESK_KEY[d]) }))}
            />
          </Field>
          <Field
            label={t('console.oncall_col_rank')}
            hint={t('console.oncall_rank_hint', {
              sec: ON_CALL_RULES.onCallAfterSec,
              sec2: ON_CALL_RULES.nextRankAfterSec,
            })}
          >
            <Segmented<'1' | '2'>
              label={t('console.oncall_col_rank')}
              value={rank}
              onChange={setRank}
              options={[
                { value: '1', label: t('console.oncall_rank_1') },
                { value: '2', label: t('console.oncall_rank_2') },
              ]}
            />
          </Field>
          <Field label={t('console.oncall_day')} htmlFor={ids.day}>
            <Input
              id={ids.day}
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="num"
            />
          </Field>
          <Field
            label={t('console.oncall_shift')}
            hint={
              slot ? (
                <span className="num">{shiftSpan(slot.startsAt, slot.endsAt)}</span>
              ) : undefined
            }
          >
            <Segmented<ShiftPreset>
              label={t('console.oncall_shift')}
              value={preset}
              onChange={setPreset}
              options={SHIFT_PRESETS.map((p) => ({ value: p, label: t(PRESET_KEY[p]) }))}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={add.isPending}
            disabled={!personId || !slot}
            needsNet
          >
            {t('console.oncall_add')}
          </Button>
        </form>
      )}
    </Card>
  );
}
