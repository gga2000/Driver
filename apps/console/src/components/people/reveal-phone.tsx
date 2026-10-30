'use client';

import { useMutation } from '@tanstack/react-query';
import type { PhoneRevealReason } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useState } from 'react';
import { hasAny, useMyRoles } from '@/lib/me';
import { errorText } from '@/lib/network';
import { localMasked, localPhone, REVEAL_REASONS, revealReasonLabel } from '@/lib/people';
import { useTRPC } from '@/lib/trpc';
import { Button, Dialog, IconPhone, Segmented } from '../ui';

/**
 * The number as «077•••••44» with «اكشف الرقم»: the staff member says why (one of four reasons), the
 * API reads the whole number once (a vault access row and an audit row with the reason) and it shows
 * here, dialable, until the page is left. Support, dispatch and admins only.
 */
export function RevealPhone({ personId, masked }: { personId: string; masked: string | null }) {
  const trpc = useTRPC();
  const me = useMyRoles();
  const canReveal = hasAny(me.roles, ['support', 'dispatcher', 'admin']);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<PhoneRevealReason>('call_about_order');
  const reveal = useMutation(trpc.people.revealPhone.mutationOptions({ onSuccess: () => setOpen(false) }));
  const phone = reveal.data?.phone ?? null;
  const shown = localMasked(masked);

  if (phone) {
    return (
      <a href={`tel:${phone}`} className="num ltr inline-flex items-center gap-1.5 text-[15px] font-semibold text-accent-text hover:underline">
        <IconPhone size={16} />
        {localPhone(phone)}
      </a>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="num ltr text-[15px] tracking-wide">{shown ?? t('console.ppl_no_phone')}</span>
      {shown && canReveal ? (
        <Button size="sm" onClick={() => setOpen(true)}>
          {t('console.ppl_reveal')}
        </Button>
      ) : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('console.ppl_reveal_title')}
        description={t('console.ppl_reveal_hint')}
        width="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('console.cancel')}
            </Button>
            <Button variant="primary" needsNet loading={reveal.isPending} onClick={() => reveal.mutate({ personId, reason })}>
              {t('console.ppl_reveal_go')}
            </Button>
          </>
        }
      >
        <Segmented size="sm" label={t('console.ppl_reveal_why')} value={reason} onChange={setReason} options={REVEAL_REASONS.map((r) => ({ value: r, label: revealReasonLabel(r) }))} className="flex-wrap" />
        {reveal.error ? <p className="mt-3 text-dense text-bad">{errorText(reveal.error)}</p> : null}
      </Dialog>
    </span>
  );
}
