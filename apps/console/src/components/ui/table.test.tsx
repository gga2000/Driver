import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataTable, scrollToRow, VIRTUAL_MIN, windowRange } from './table';

describe('DataTable windowing (CON-14)', () => {
  it('draws only the rows in view plus a margin, with spacers for the rest', () => {
    const r = windowRange(44 * 1000, 440, 44, 5000, 12);
    expect(r.start).toBe(988);
    expect(r.end).toBe(1022);
    expect(r.before).toBe(988 * 44);
    expect(r.after).toBe((5000 - 1022) * 44);
    expect(windowRange(0, 440, 44, 5000, 12).start).toBe(0);
    expect(windowRange(99_999_999, 440, 44, 50, 12)).toMatchObject({ start: 50, end: 50, after: 0 });
  });

  it('scrolls the active row into view under the sticky header, and leaves it when it is visible', () => {
    expect(scrollToRow(0, 400, 40, 40, 30)).toBe(31 * 40 - 400 + 40);
    expect(scrollToRow(2000, 400, 40, 40, 10)).toBe(400);
    expect(scrollToRow(400, 400, 40, 40, 12)).toBe(400);
  });

  it('a dinner peak of 3,000 orders renders tens of rows, and still tells screen readers the total', () => {
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: `o${i}`, n: i }));
    const html = renderToString(
      <DataTable columns={[{ key: 'n', header: 'n', cell: (r) => r.n, numeric: true }]} rows={rows} rowKey={(r) => r.id} />,
    );
    const drawn = html.match(/data-row/g)?.length ?? 0;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThan(80);
    expect(html).toContain('aria-rowcount="3001"');
  });

  it('short lists are drawn whole, without row counts', () => {
    const rows = Array.from({ length: VIRTUAL_MIN - 1 }, (_, i) => ({ id: `o${i}` }));
    const html = renderToString(<DataTable columns={[{ key: 'id', header: 'id', cell: (r) => r.id }]} rows={rows} rowKey={(r) => r.id} />);
    expect(html.match(/data-row/g)?.length).toBe(VIRTUAL_MIN - 1);
    expect(html).not.toContain('aria-rowcount');
  });
});
