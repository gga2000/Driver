'use client';

import { t } from '@driver/i18n';
import { useEffect, useRef } from 'react';
import { fileUrl } from '@/lib/control-room';
import { API_URL } from '@/lib/trpc';
import { IconButton, IconClose } from './ui';

/** A photo full size over a dark backdrop (Esc, the close button or a tap outside closes it). */
export function PhotoZoom({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-label={label} className="m-auto max-h-[92vh] max-w-[92vw] overflow-visible bg-transparent p-0 backdrop:bg-inverse/80" onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed API URLs */}
      <img src={fileUrl(url, API_URL)} alt={label} className="max-h-[86vh] max-w-[92vw] rounded-lg object-contain shadow-overlay" />
      <p className="mt-2 text-center text-sm text-on-inverse">{label}</p>
      <IconButton label={t('console.close')} variant="secondary" className="absolute -top-3 end-[-12px]" onClick={() => ref.current?.close()}>
        <IconClose size={18} />
      </IconButton>
    </dialog>
  );
}
