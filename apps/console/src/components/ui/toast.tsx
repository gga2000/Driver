'use client';

import { t } from '@driver/i18n';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cx } from './button';
import { IconAlert, IconCheckCircle, IconClose } from './icons';

/**
 * Toasts confirm what just happened, in the action's own word ("أرسلت الرد", "تعوّض 2,000 دينار").
 * Inverse ink on cream, bottom end corner, 5 s, one action at most. Errors stay until closed.
 */

export interface ToastInput {
  title: string;
  body?: string;
  tone?: 'default' | 'ok' | 'bad';
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastInput {
  id: number;
}

const Ctx = createContext<(t: ToastInput) => void>(() => undefined);

export function useToast() {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((input: ToastInput) => {
    setItems((xs) => [...xs.slice(-2), { ...input, id: Date.now() + Math.random() }]);
  }, []);
  const close = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const value = useMemo(() => push, [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      >
        {items.map((it) => (
          <ToastView key={it.id} item={it} onClose={() => close(it.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  useEffect(() => {
    if (item.tone === 'bad') return;
    const id = window.setTimeout(onClose, 5000);
    return () => window.clearTimeout(id);
  }, [item.tone, onClose]);
  return <ToastCard item={item} onClose={onClose} />;
}

/** The toast surface on its own (the /design page shows it in place). */
export function ToastCard({ item, onClose }: { item: ToastInput; onClose?: () => void }) {
  return (
    <div className="pointer-events-auto flex animate-pop-in items-start gap-3 rounded-lg bg-inverse px-4 py-3 text-on-inverse shadow-overlay">
      <span
        className={cx('mt-0.5 shrink-0', item.tone === 'bad' ? 'text-bad-solid' : 'text-ok-solid')}
      >
        {item.tone === 'bad' ? <IconAlert size={18} /> : <IconCheckCircle size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title}</p>
        {item.body ? <p className="mt-0.5 text-dense opacity-80">{item.body}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          onClick={item.action.onClick}
          className="shrink-0 rounded-md px-2 py-0.5 text-sm font-semibold underline-offset-4 hover:underline"
        >
          {item.action.label}
        </button>
      ) : null}
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={t('console.close')}
          className="-me-1 shrink-0 rounded-md p-0.5 opacity-70 hover:opacity-100"
        >
          <IconClose size={16} />
        </button>
      ) : null}
    </div>
  );
}
