'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { t } from '@driver/i18n';
import { useId, useState, type FormEvent } from 'react';
import { queryRetry } from '@/lib/live';
import { errorText } from '@/lib/network';
import { baghdadToday, quietRange } from '@/lib/quiet';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, Field, Input, useToast } from './ui';

/**
 * Quiet days (customer joy J1a): mourning days on which every app plays no celebrations or moment
 * sounds and the server sends no offers. Admins set and remove them; everyone on the Console sees them.
 */
export function QuietDaysCard({ signedIn, canEdit }: { signedIn: boolean; canEdit: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const ids = { from: useId(), to: useId(), label: useId() };
  const today = baghdadToday();
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [label, setLabel] = useState('');
  const list = useQuery(trpc.system.quietDays.queryOptions(undefined, { enabled: signedIn, refetchInterval: 60_000, retry: queryRetry }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: trpc.system.quietDays.queryKey() });
    void qc.invalidateQueries({ queryKey: trpc.ops.controls.audit.queryKey() });
  };
  const set = useMutation(
    trpc.system.setQuietDays.mutationOptions({
      onSuccess: () => {
        setLabel('');
        refresh();
        toast({ title: t('console.quiet_saved'), tone: 'ok' });
      },
    }),
  );
  const clear = useMutation(
    trpc.system.clearQuietDays.mutationOptions({
      onSuccess: () => {
        refresh();
        toast({ title: t('console.quiet_cleared_toast'), tone: 'ok' });
      },
    }),
  );
  const trimmed = label.trim();
  const valid = trimmed.length >= 3 && startsOn >= today && endsOn >= startsOn;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    set.mutate({ cityId: null, startsOn, endsOn, label_ar: trimmed });
  };
  const rows = (list.data ?? []).filter((q) => !q.clearedAt && q.endsOn >= today);
  return (
    <Card title={t('console.quiet_title')} hint={t('console.quiet_hint')} actions={!canEdit ? <Chip>{t('console.banner_admin_only')}</Chip> : undefined}>
      {rows.length > 0 && (
        <ul className="mb-5 space-y-2">
          {rows.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <Chip tone={q.active ? 'warn' : 'neutral'} dot size="sm">
                    {q.active ? t('console.quiet_now') : t('console.quiet_coming')}
                  </Chip>
                  <span className="min-w-0">{q.label_ar}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {quietRange(q.startsOn, q.endsOn)} · {q.setByName ?? t('console.someone')}
                </p>
              </div>
              {canEdit && (
                <Button variant="danger-soft" size="sm" loading={clear.isPending && clear.variables?.quietId === q.id} onClick={() => clear.mutate({ quietId: q.id })}>
                  {t('console.quiet_clear')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <fieldset disabled={!canEdit} className="flex flex-wrap items-end gap-3 disabled:opacity-60">
          <Field label={t('console.quiet_from')} htmlFor={ids.from} className="w-40">
            <Input
              id={ids.from}
              type="date"
              min={today}
              value={startsOn}
              onChange={(e) => {
                setStartsOn(e.target.value);
                if (endsOn < e.target.value) setEndsOn(e.target.value);
              }}
            />
          </Field>
          <Field label={t('console.quiet_to')} htmlFor={ids.to} className="w-40">
            <Input id={ids.to} type="date" min={startsOn} value={endsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
          <Field label={t('console.quiet_label')} htmlFor={ids.label} className="min-w-[14rem] flex-1">
            <Input id={ids.label} maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('console.quiet_placeholder')} />
          </Field>
          <Button type="submit" variant="primary" disabled={!valid} loading={set.isPending}>
            {t('console.quiet_save')}
          </Button>
        </fieldset>
        {set.error && <p className="mt-2 text-sm text-bad">{errorText(set.error)}</p>}
      </form>
    </Card>
  );
}
