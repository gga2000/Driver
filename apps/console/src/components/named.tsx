'use client';

import Link from 'next/link';
import type { VehicleClass } from '@driver/contracts';
import { t } from '@driver/i18n';
import { useEffect, useState, type ReactNode } from 'react';
import { shortId } from '@/lib/format';
import { accountRef, isSystemActor, orderLabel, personText, useNames } from '@/lib/names';
import { Mono } from './ui';

/**
 * K-01 / K-02: names and order numbers in place of ids. Each shows the words first ("حيدر ك. ·
 * تكتك · واسط 45671", "مطعم خالد", "#1284"); the raw id stays one hover (title) or one click (copy
 * button) away for support. Without a name the short id shows, as before.
 */

/** Copies the raw id; says "انتسخ" for a moment. */
export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void navigator.clipboard?.writeText(id).then(() => setCopied(true), () => undefined);
      }}
      title={copied ? t('console.copied') : id}
      aria-label={t('console.copy_id', { id })}
      className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint opacity-60 after:absolute after:-inset-2 after:content-[''] hover:text-accent hover:opacity-100 focus-visible:opacity-100"
    >
      {copied ? (
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 text-ok" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
          <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" />
        </svg>
      )}
      <span className="sr-only" aria-live="polite">
        {copied ? t('console.copied') : ''}
      </span>
    </button>
  );
}

/** Words (linked when `href`) with the raw id on hover and a copy button; the short id when there are no words. */
function Labelled({ id, text, href, className = '', copy = true, strong }: { id: string; text: string | null; href?: string | undefined; className?: string | undefined; copy?: boolean | undefined; strong?: boolean | undefined }) {
  const body: ReactNode = text ? (
    <span title={id} className={`min-w-0 truncate ${strong ? 'font-semibold' : ''}`}>
      {text}
    </span>
  ) : (
    <Mono title={id}>{shortId(id)}</Mono>
  );
  return (
    <span className={`inline-flex max-w-full items-center gap-1 align-baseline ${className}`}>
      {href ? (
        <Link href={href} className="min-w-0 truncate text-accent underline">
          {body}
        </Link>
      ) : (
        body
      )}
      {copy && <CopyId id={id} />}
    </span>
  );
}

/** A person by name; drivers with vehicle and plate when `vehicle` is set. */
export function PersonName({
  id,
  vehicle = false,
  vehicleClass,
  href,
  className,
  copy,
  strong,
}: {
  id: string;
  vehicle?: boolean;
  /** The live class from presence (wins over the registry's). */
  vehicleClass?: VehicleClass | null | undefined;
  href?: string;
  className?: string;
  copy?: boolean;
  strong?: boolean;
}) {
  const names = useNames({ people: [id] });
  const system = isSystemActor(id);
  return (
    <Labelled
      id={id}
      text={personText(id, names.person(id), { vehicle, vehicleClass: vehicleClass ?? null })}
      href={system ? undefined : href}
      className={className}
      copy={system ? false : copy}
      strong={strong}
    />
  );
}

/** A merchant (or any org) by name. */
export function OrgName({ id, href, className, copy }: { id: string; href?: string; className?: string; copy?: boolean }) {
  const names = useNames({ orgs: [id] });
  return <Labelled id={id} text={names.org(id)?.name ?? null} href={href} className={className} copy={copy} />;
}

/** A dish by its menu name; the catalog id only when the menu no longer has it. */
export function ItemName({ orgId, itemId }: { orgId: string | null; itemId: string }) {
  const names = useNames({ items: [{ orgId, itemId }] });
  const name = orgId ? names.item(orgId, itemId)?.name : undefined;
  return <Labelled id={itemId} text={name ?? null} copy={!name} />;
}

/** "#1284", linked to the order page by default; the raw order id on hover and copy. */
export function OrderRef({ id, link = true, copy = true, className, strong }: { id: string; link?: boolean; copy?: boolean; className?: string; strong?: boolean }) {
  return <Labelled id={id} text={orderLabel(id)} href={link ? `/orders/${encodeURIComponent(id)}` : undefined} className={`tabular-nums ${className ?? ''}`} copy={copy} strong={strong} />;
}

/** A ledger account in words: the driver, the restaurant, the customer, البنك… */
export function AccountName({ account }: { account: string }) {
  const ref = accountRef(account);
  if (!ref) return <Mono>{account}</Mono>;
  if ('label' in ref) return <span>{ref.label}</span>;
  return ref.kind === 'person' ? <PersonName id={ref.id} copy={false} /> : <OrgName id={ref.id} copy={false} />;
}
