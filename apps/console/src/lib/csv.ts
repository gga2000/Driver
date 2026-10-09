/**
 * CSV for finance and for Ali (v6): what's on screen, with the same filters. A BOM so Excel reads
 * the Arabic, CRLF line ends, and every cell quoted when it needs to be. A cell that starts like a
 * formula (= + - @) gets a leading quote so a spreadsheet never runs it.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  // Screen-only direction marks (⁦…⁩) would show as junk in a spreadsheet.
  let s = String(v).replace(/[\u2066-\u2069\u200e\u200f]/g, '');
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  return `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** "2026-10-09 21:05" on the city's clock, the way spreadsheets sort it. */
export function csvTime(d: Date | null | undefined, timeZone = 'Asia/Baghdad'): string {
  if (!d) return '';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p['year']}-${p['month']}-${p['day']} ${p['hour']}:${p['minute']}`;
}

/** Hands the file to the browser as a download. */
export function downloadCsv(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
