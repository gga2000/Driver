'use client';

import type { ReactNode } from 'react';
import { cx } from './button';
import { EmptyState, Skeleton } from './empty';

/**
 * DataTable: sticky header, quiet row hover, optional selection, skeleton rows on first load and an
 * empty state that says what to do. Columns align to the start (right in RTL); numbers align to the
 * end and use tabular digits so amounts line up. Row height follows the density setting.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Numbers: end-aligned, tabular. */
  numeric?: boolean;
  width?: string;
  className?: string;
}

/** Class strings for tables written by hand (same look as DataTable). */
export const tableCls = 'w-full border-separate border-spacing-0 text-dense';
export const theadCls = 'sticky top-0 z-[1] bg-surface/95 backdrop-blur-sm';
export const thCls =
  'border-b border-line px-[var(--row-x)] py-2 text-start text-xs font-medium text-muted';
export const tdCls = 'border-b border-line/70 px-[var(--row-x)] py-[var(--row-y)] align-middle';
export const trCls = 'transition-colors duration-fast hover:bg-surface-2';

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  selected,
  onToggle,
  onRowClick,
  activeKey,
  caption,
  className,
  maxHeight,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  empty?: { title: string; hint?: string; action?: ReactNode };
  /** Selection: the selected keys and a toggle; adds a checkbox column. */
  selected?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
  caption?: string;
  className?: string;
  maxHeight?: string;
}) {
  const selectable = Boolean(selected && onToggle);
  const list = rows ?? [];
  return (
    <div
      className={cx(
        'overflow-auto rounded-lg border border-line bg-surface shadow-card',
        className,
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className={tableCls}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className={theadCls}>
          <tr>
            {selectable ? <th className={cx(thCls, 'w-10')} aria-label="select" /> : null}
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={c.width ? { width: c.width } : undefined}
                className={cx(thCls, c.numeric && 'text-end')}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && list.length === 0
            ? Array.from({ length: 6 }, (_, i) => (
                <tr key={`sk-${i}`}>
                  {selectable ? <td className={tdCls} /> : null}
                  {columns.map((c, j) => (
                    <td key={c.key} className={tdCls}>
                      <Skeleton
                        className={cx(
                          'h-3.5',
                          j === 0 ? 'w-24' : c.numeric ? 'ms-auto w-14' : 'w-20',
                        )}
                      />
                    </td>
                  ))}
                </tr>
              ))
            : list.map((row) => {
                const key = rowKey(row);
                const isSel = selected?.has(key) ?? false;
                return (
                  <tr
                    key={key}
                    aria-selected={selectable ? isSel : undefined}
                    data-active={activeKey === key || undefined}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cx(
                      trCls,
                      onRowClick && 'cursor-pointer',
                      (isSel || activeKey === key) && 'bg-accent-wash hover:bg-accent-wash',
                    )}
                  >
                    {selectable ? (
                      <td className={tdCls} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => onToggle!(key)}
                          className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                          aria-label={key}
                        />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={cx(tdCls, c.numeric && 'num text-end', c.className)}
                      >
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
        </tbody>
      </table>
      {!loading && list.length === 0 && empty ? (
        <div className="p-6">
          <EmptyState title={empty.title} hint={empty.hint} bare>
            {empty.action}
          </EmptyState>
        </div>
      ) : null}
    </div>
  );
}
