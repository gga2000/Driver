'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from './button';
import { EmptyState, Skeleton } from './empty';

/**
 * DataTable: sticky header, quiet row hover, optional selection, skeleton rows on first load and an
 * empty state that says what to do. Columns align to the start (right in RTL); numbers align to the
 * end and use tabular digits so amounts line up. Row height follows the density setting.
 *
 * Long lists are windowed (CON-14): past `VIRTUAL_MIN` rows only the rows in view (plus a margin)
 * are in the page, between two spacer rows, so a dinner peak of thousands of orders scrolls and
 * re-renders like fifty. The table keeps `aria-rowcount` / `aria-rowindex`, so a screen reader still
 * hears "row 812 of 2,400", and the active row (j / k) is scrolled into view even when not drawn.
 */

/** Below this many rows every row is drawn (no windowing). */
export const VIRTUAL_MIN = 120;
const OVERSCAN = 12;
const FALLBACK_ROW_PX = 44;

/** The rows to draw for a scroll position: `[start, end)` plus the spacer heights around them. */
export function windowRange(
  scrollTop: number,
  viewport: number,
  rowPx: number,
  count: number,
  overscan = OVERSCAN,
): { start: number; end: number; before: number; after: number } {
  const h = rowPx > 0 ? rowPx : FALLBACK_ROW_PX;
  const first = Math.floor(Math.max(0, scrollTop) / h);
  const visible = Math.ceil(Math.max(viewport, h) / h);
  const start = Math.max(0, Math.min(count, first - overscan));
  const end = Math.max(start, Math.min(count, first + visible + overscan));
  return { start, end, before: start * h, after: (count - end) * h };
}

/** scrollTop that brings row `index` into view (or the current one if it already is). */
export function scrollToRow(
  scrollTop: number,
  viewport: number,
  headerPx: number,
  rowPx: number,
  index: number,
): number {
  const top = index * rowPx;
  const bottom = top + rowPx;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport - headerPx) return bottom - viewport + headerPx;
  return scrollTop;
}

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
  const virtual = list.length >= VIRTUAL_MIN;
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLTableSectionElement>(null);
  const [view, setView] = useState({ top: 0, height: 800, rowPx: FALLBACK_ROW_PX });

  // Measure the scroll box and one drawn row; re-measure on resize and density changes.
  useLayoutEffect(() => {
    const el = box.current;
    if (!virtual || !el) return;
    const measure = () => {
      const row = el.querySelector<HTMLTableRowElement>('tbody tr[data-row]');
      setView({
        top: el.scrollTop,
        height: el.clientHeight,
        rowPx: row?.offsetHeight || FALLBACK_ROW_PX,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [virtual]);

  const activeIndex = virtual && activeKey ? list.findIndex((r) => rowKey(r) === activeKey) : -1;
  useEffect(() => {
    const el = box.current;
    if (activeIndex < 0 || !el) return;
    const next = scrollToRow(
      el.scrollTop,
      el.clientHeight,
      head.current?.offsetHeight ?? 0,
      view.rowPx,
      activeIndex,
    );
    if (next !== el.scrollTop) el.scrollTop = next;
  }, [activeIndex, view.rowPx]);

  const range = virtual
    ? windowRange(view.top, view.height, view.rowPx, list.length)
    : { start: 0, end: list.length, before: 0, after: 0 };
  const drawn = virtual ? list.slice(range.start, range.end) : list;
  const span = columns.length + (selectable ? 1 : 0);
  return (
    <div
      ref={box}
      onScroll={
        virtual
          ? (e) => {
              const top = e.currentTarget.scrollTop;
              setView((v) => (v.top === top ? v : { ...v, top }));
            }
          : undefined
      }
      className={cx(
        'overflow-auto rounded-lg border border-line bg-surface shadow-card',
        className,
      )}
      style={maxHeight || virtual ? { maxHeight: maxHeight ?? 'calc(100vh - 14rem)' } : undefined}
    >
      <table className={tableCls} aria-rowcount={virtual ? list.length + 1 : undefined}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead ref={head} className={theadCls}>
          <tr aria-rowindex={virtual ? 1 : undefined}>
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
            : [
                range.before > 0 ? (
                  <tr key="before" aria-hidden style={{ height: range.before }}>
                    <td colSpan={span} className="p-0" />
                  </tr>
                ) : null,
                ...drawn.map((row, i) => {
                  const key = rowKey(row);
                  const isSel = selected?.has(key) ?? false;
                  return (
                    <tr
                      key={key}
                      data-row
                      aria-rowindex={virtual ? range.start + i + 2 : undefined}
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
                }),
                range.after > 0 ? (
                  <tr key="after" aria-hidden style={{ height: range.after }}>
                    <td colSpan={span} className="p-0" />
                  </tr>
                ) : null,
              ]}
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
