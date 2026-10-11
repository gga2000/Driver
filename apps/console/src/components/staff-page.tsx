'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { OnCallStaff } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { staffRoleLabel } from '@/lib/labels';
import { queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { Button, Card, Chip, DataTable, Dialog, NeedLogin, PageHeader, QueryError, useToast, type Column } from './ui';

/**
 * Console › الموظفين (admins): everyone who holds a Console role, with those roles, and
 * «طلّعه من كل الأجهزة» for a lost or stolen phone or laptop: every session of that person ends on
 * every device at once (`identity.endAllSessions`, audited). They keep their roles and sign in again
 * on their own device.
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
          <Button size="sm" variant="ghost" needsNet onClick={() => setEnding(s)}>
            {t('console.staffpage_end')}
          </Button>
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
    </Card>
  );
}
