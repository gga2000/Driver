'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { SECOND_STEP_ROLE_KINDS, type OnCallStaff } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useId, useState } from 'react';
import { staffRoleLabel } from '@/lib/labels';
import { queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, DataTable, Dialog, Field, Input, NeedLogin, PageHeader, QueryError, useToast, type Column } from './ui';

/**
 * Console › الموظفين (admins): everyone who holds a Console role, with those roles, and
 * «طلّعه من كل الأجهزة» for a lost or stolen phone or laptop: every session of that person ends on
 * every device at once (`identity.endAllSessions`, audited). They keep their roles and sign in again
 * on their own device.
 * «صفّر تطبيق المصادقة» for an admin or finance member who lost the phone with their authenticator
 * (docs/api/staff-totp.md): it needs the admin's own fresh code, never works on yourself, signs them out
 * everywhere and is audited; they set the app up again at their next sign-in.
 */
export function StaffPage() {
  const signedIn = useSignedIn();
  return (
    <div className="mx-auto max-w-[980px]">
      <PageHeader title={t('console.staffpage_title')} subtitle={t('console.staffpage_subtitle')} />
      {!signedIn ? <NeedLogin /> : <StaffList />}
    </div>
  );
}

function StaffList() {
  const trpc = useTRPC();
  const toast = useToast();
  const { personId: me } = useMyRoles();
  const staff = useQuery(trpc.onCall.staff.queryOptions(undefined, { retry: queryRetry, staleTime: 60_000 }));
  const [ending, setEnding] = useState<OnCallStaff | null>(null);
  const [resetting, setResetting] = useState<OnCallStaff | null>(null);
  const name = (s: OnCallStaff) => s.displayName ?? t('console.staff_unknown');
  const end = useMutation(
    trpc.identity.endAllSessions.mutationOptions({
      onSuccess: () => {
        toast({ title: t('console.staffpage_ended', { name: ending ? name(ending) : t('console.staff_unknown') }), tone: 'ok' });
        setEnding(null);
      },
      onError: (e) => toast({ title: t('console.staffpage_failed', { message: errorText(e) }), tone: 'bad' }),
    }),
  );
  const columns: Column<OnCallStaff>[] = [
    {
      key: 'who',
      header: t('console.staffpage_col_who'),
      cell: (s) => (
        <>
          <span className="font-medium text-text">
            {name(s)}
            {s.personId === me ? <span className="ms-2 text-xs font-normal text-muted">{t('console.staffpage_you')}</span> : null}
          </span>
          {/* A phone drops the roles column: the roles go under the name instead. */}
          <span className="mt-0.5 block text-xs text-muted sm:hidden">{s.roles.map(staffRoleLabel).join(' · ')}</span>
        </>
      ),
    },
    {
      key: 'roles',
      header: t('console.staffpage_col_roles'),
      hideOnPhone: true,
      cell: (s) => (
        <span className="flex flex-wrap gap-1.5">
          {s.roles.map((r) => (
            <Chip key={r} size="sm">
              {staffRoleLabel(r)}
            </Chip>
          ))}
        </span>
      ),
    },
    {
      key: 'act',
      header: <span className="sr-only">{t('console.staffpage_end')}</span>,
      cell: (s) =>
        s.personId === me ? null : (
          <span className="flex flex-wrap justify-end gap-1">
            {s.roles.some((r) => (SECOND_STEP_ROLE_KINDS as readonly string[]).includes(r)) && (
              <Button size="sm" variant="ghost" needsNet onClick={() => setResetting(s)}>
                {t('console.totp_reset')}
              </Button>
            )}
            <Button size="sm" variant="ghost" needsNet onClick={() => setEnding(s)}>
              {t('console.staffpage_end')}
            </Button>
          </span>
        ),
    },
  ];
  return (
    <Card title={t('console.staffpage_list_title')} flush>
      {staff.isError ? (
        <div className="p-5">
          <QueryError error={staff.error} onRetry={() => void staff.refetch()} />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={staff.data}
          rowKey={(s) => s.personId}
          loading={staff.isPending}
          caption={t('console.staffpage_list_title')}
          empty={{ title: t('console.staffpage_empty') }}
        />
      )}
      <Dialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={t('console.staffpage_end_title', { name: ending ? name(ending) : '' })}
        width="sm"
        footer={
          <>
            <Button onClick={() => setEnding(null)}>{t('console.cancel')}</Button>
            <Button variant="danger" loading={end.isPending} needsNet onClick={() => ending && end.mutate({ personId: ending.personId })}>
              {t('console.staffpage_end')}
            </Button>
          </>
        }
      >
        <p className="text-dense text-muted">{t('console.staffpage_end_body')}</p>
      </Dialog>
      {resetting && <ResetDialog who={resetting} name={name(resetting)} onClose={() => setResetting(null)} />}
    </Card>
  );
}

/** «صفّر تطبيق المصادقة»: the admin types his own current code; the server checks it, audits and notifies. */
function ResetDialog({ who, name, onClose }: { who: OnCallStaff; name: string; onClose: () => void }) {
  const trpc = useTRPC();
  const toast = useToast();
  const id = useId();
  const [code, setCode] = useState('');
  const reset = useMutation(
    trpc.identity.authenticator.reset.mutationOptions({
      onSuccess: () => {
        toast({ title: t('console.totp_reset_done', { name }), tone: 'ok' });
        onClose();
      },
    }),
  );
  const ok = /^\d{6}$/.test(code);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('console.totp_reset_title', { name })}
      width="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('console.cancel')}</Button>
          <Button variant="danger" loading={reset.isPending} needsNet disabled={!ok} onClick={() => reset.mutate({ personId: who.personId, code })}>
            {t('console.totp_reset')}
          </Button>
        </>
      }
    >
      <p className="text-dense text-muted">{t('console.totp_reset_body')}</p>
      <Field label={t('console.totp_reset_code')} htmlFor={id} className="mt-4">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          dir="ltr"
          autoFocus
          className="num h-12 text-center text-xl font-semibold tracking-[0.4em]"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </Field>
      {reset.error && (
        <p className="mt-3 text-dense text-bad" role="alert">
          {errorText(reset.error)}
        </p>
      )}
    </Dialog>
  );
}
