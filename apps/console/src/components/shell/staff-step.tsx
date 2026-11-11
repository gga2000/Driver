'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { StaffTotpEnrolView, StaffTotpLockView } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { formatClock } from '@/lib/format';
import { queryRetry } from '@/lib/live';
import { useMyRoles } from '@/lib/me';
import { useSignedIn } from '@/lib/session';
import { useTRPC } from '@/lib/trpc';
import { IconLock, IconShield } from '../ui';

const ROW_H = 44;
const LOCK_POLL_MS = 30_000;
const NONE: StaffTotpLockView[] = [];
const NO_ENROLMENTS: StaffTotpEnrolView[] = [];

/**
 * The staff authenticator on every page (docs/api/staff-totp.md):
 * - a session that still owes the admin/finance second step goes back to the sign-in page for it;
 * - admins see a row per staff member locked out by 5 wrong codes in a row, until the lock ends, and a
 *   row per staff member who set up an authenticator (first time or after a reset) in the last day
 *   (the server sends both as pushes to admins too). Its height is published as `--totp-h`.
 */
export function StaffStepWatch() {
  const router = useRouter();
  const trpc = useTRPC();
  const signedIn = useSignedIn();
  const { roles, loaded, secondStep } = useMyRoles();
  useEffect(() => {
    if (secondStep) router.replace('/login');
  }, [secondStep, router]);
  const allowed = signedIn && loaded && !secondStep && roles.has('admin');
  const q = useQuery(trpc.identity.authenticator.locks.queryOptions(undefined, { enabled: allowed, refetchInterval: LOCK_POLL_MS, retry: queryRetry }));
  const e = useQuery(trpc.identity.authenticator.enrolments.queryOptions(undefined, { enabled: allowed, refetchInterval: LOCK_POLL_MS, retry: queryRetry }));
  const rows = allowed ? (q.data ?? NONE) : NONE;
  const enrolments = allowed ? (e.data ?? NO_ENROLMENTS) : NO_ENROLMENTS;
  const count = rows.length + enrolments.length;

  useEffect(() => {
    const root = document.documentElement;
    if (count > 0) root.style.setProperty('--totp-h', `${count * ROW_H}px`);
    else root.style.removeProperty('--totp-h');
    return () => {
      root.style.removeProperty('--totp-h');
    };
  }, [count]);

  if (count === 0) return null;
  return <StaffLockRows rows={rows} enrolments={enrolments} />;
}

/**
 * «فلان: 5 رموز مصادقة غلط ورا بعض، دخوله مقفول لحد 3:40» and «فلان: ربط تطبيق مصادقة جديد الساعة 2:10 م»,
 * each linking to the staff page (where an admin can reset it).
 */
export function StaffLockRows({ rows, enrolments = [] }: { rows: readonly StaffTotpLockView[]; enrolments?: readonly StaffTotpEnrolView[] }) {
  return (
    <div role="alert" data-testid="totp-locks" className="shrink-0 border-b border-warn/50 bg-warn-tint text-text">
      {rows.map((r) => (
        <Link key={r.personId} href="/staff" className="flex h-11 items-center gap-3 px-4 hover:bg-warn/10 lg:px-8">
          <IconLock size={18} className="shrink-0 text-warn" />
          <p className="num min-w-0 flex-1 truncate text-sm font-semibold">
            {t('console.totp_locked', { name: r.displayName ?? t('console.staff_unknown'), time: formatClock(new Date(r.lockedUntil)) })}
          </p>
        </Link>
      ))}
      {enrolments.map((r) => (
        <Link key={`enrol-${r.personId}`} href="/staff" className="flex h-11 items-center gap-3 px-4 hover:bg-warn/10 lg:px-8">
          <IconShield size={18} className="shrink-0 text-warn" />
          <p className="num min-w-0 flex-1 truncate text-sm font-semibold">
            {t('console.totp_enrolled', { name: r.displayName ?? t('console.staff_unknown'), time: formatClock(new Date(r.enrolledAt)) })}
          </p>
        </Link>
      ))}
    </div>
  );
}
