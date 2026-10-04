'use client';

import {
  forwardRef,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { cx } from './button';
import { IconChevronDown } from './icons';

/**
 * Form controls. Edges are `line-strong` (≥ 3:1, WCAG 1.4.11); the focus ring is the global rust
 * outline; `aria-invalid` turns the edge red and the error text says what to do.
 */

const fieldCls =
  'w-full rounded-md border border-line-strong/80 bg-surface px-3 text-sm text-text placeholder:text-faint transition-colors duration-fast hover:border-line-strong focus:border-accent-text disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60 aria-[invalid=true]:border-bad';
const heightCls = 'h-[var(--ctl-h)]';
/** For plain <input>/<textarea>/<select> elements styled by class. */
export const inputCls = `${fieldCls} py-[7px]`;

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={cx('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-dense font-medium text-text">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }
>(function Input({ className, leading, ...rest }, ref) {
  if (!leading) return <input ref={ref} className={cx(fieldCls, heightCls, className)} {...rest} />;
  return (
    <span className="relative block">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted"
      >
        {leading}
      </span>
      <input ref={ref} className={cx(fieldCls, heightCls, 'ps-9', className)} {...rest} />
    </span>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={cx(fieldCls, 'min-h-[72px] py-2 leading-6', className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <span className="relative block">
        <select
          ref={ref}
          className={cx(fieldCls, heightCls, 'appearance-none pe-9', className)}
          {...rest}
        >
          {children}
        </select>
        <IconChevronDown
          size={16}
          className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted"
        />
      </span>
    );
  },
);

/** A checkbox with its label as the hit area. */
export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="inline-flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-[3px] h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * Combobox: type to filter a list, arrows to move, Enter to pick, Escape to close (ARIA 1.2
 * combobox pattern with a listbox popup).
 */
export function Combobox<T>({
  items,
  value,
  onChange,
  itemKey,
  itemLabel,
  placeholder,
  label,
  emptyText,
}: {
  items: T[];
  value: T | null;
  onChange: (v: T) => void;
  itemKey: (t: T) => string;
  itemLabel: (t: T) => string;
  placeholder?: string;
  label: string;
  emptyText: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const list = useMemo(
    () => items.filter((i) => itemLabel(i).includes(q.trim())),
    [items, q, itemLabel],
  );
  const pick = (t: T) => {
    onChange(t);
    setQ('');
    setOpen(false);
  };
  return (
    <div className="relative">
      <Input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open && list[active] ? `${id}-${itemKey(list[active]!)}` : undefined}
        autoComplete="off"
        placeholder={value ? itemLabel(value) : placeholder}
        value={q}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(list.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open && list[active]) {
            e.preventDefault();
            pick(list[active]!);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <IconChevronDown
        size={16}
        className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-muted"
      />
      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-auto rounded-md border border-line bg-raised p-1 shadow-pop animate-pop-in"
        >
          {list.length === 0 ? (
            <li className="px-3 py-2 text-dense text-muted">{emptyText}</li>
          ) : null}
          {list.map((t, i) => (
            <li
              key={itemKey(t)}
              id={`${id}-${itemKey(t)}`}
              role="option"
              aria-selected={value !== null && itemKey(value) === itemKey(t)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(t);
              }}
              onMouseEnter={() => setActive(i)}
              className={cx(
                'cursor-pointer rounded-[8px] px-3 py-1.5 text-sm',
                i === active ? 'bg-surface-2 text-text' : 'text-text',
                value !== null && itemKey(value) === itemKey(t) && 'font-semibold',
              )}
            >
              {itemLabel(t)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
