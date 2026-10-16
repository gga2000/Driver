'use client';

import { t } from '@driver/i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { cx, IconButton } from './button';
import { IconClose } from './icons';
import { OfflineNote } from './status';

/**
 * Dialog (centred, modal, native <dialog> so focus is trapped and Escape closes), Sheet (modal,
 * slides in from the end edge — left in RTL), Drawer (non-modal panel inside a positioned parent,
 * e.g. over the map) and Popover (anchored menu). Focus returns to the opener on close (native).
 */

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const w =
    width === 'sm'
      ? 'w-[min(26rem,calc(100vw-2rem))]'
      : width === 'lg'
        ? 'w-[min(44rem,calc(100vw-2rem))]'
        : 'w-[min(34rem,calc(100vw-2rem))]';
  const titleId = labelledBy ?? 'dlg-title';
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={titleId}
      className={cx(
        w,
        'rounded-xl border border-line bg-raised p-0 text-text shadow-overlay open:animate-pop-in',
      )}
    >
      <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        <IconButton label={t('console.close')} size="sm" onClick={() => ref.current?.close()}>
          <IconClose size={16} />
        </IconButton>
      </div>
      <div className="px-6 py-3">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-6 py-3">
          <OfflineNote className="me-auto" />
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  width = '28rem',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={typeof title === 'string' ? title : undefined}
      style={{ width: `min(${width}, 100vw)` }}
      className="fixed inset-y-0 end-0 start-auto m-0 h-full max-h-none border-0 border-s border-line bg-raised p-0 text-text shadow-overlay open:flex open:animate-sheet-in open:flex-col"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <IconButton label={t('console.close')} size="sm" onClick={() => ref.current?.close()}>
          <IconClose size={16} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <OfflineNote className="me-auto" />
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Non-modal side panel inside a positioned parent: from the end edge (left in RTL) on desktop, a
 * bottom sheet on phones. Escape closes; focus moves into it when it opens.
 */
export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={typeof title === 'string' ? title : undefined}
      className="absolute inset-x-0 bottom-0 z-20 max-h-[70%] animate-pop-in overflow-y-auto rounded-t-xl border border-line bg-raised p-4 shadow-overlay md:inset-x-auto md:bottom-auto md:end-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-96 md:rounded-xl focus-visible:outline-none"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <IconButton label={t('console.close')} size="sm" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
      </div>
      {children}
    </div>
  );
}

/** An anchored panel (menus, pickers). The parent must be `relative`. Click outside or Escape closes. */
export function Popover({
  open,
  onClose,
  children,
  className,
  align = 'start',
  side = 'bottom',
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  side?: 'top' | 'bottom';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      className={cx(
        'absolute z-40 min-w-56 animate-pop-in rounded-lg border border-line bg-raised p-1 shadow-pop',
        side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5',
        align === 'start' ? 'start-0' : 'end-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
