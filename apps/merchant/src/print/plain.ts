import type { Block, PrintDoc, PrintItem } from './doc';

/**
 * A document as monospace text (logical order; the viewer handles direction), for logs and tests.
 * Bold → `**…**`. 48 columns on 80 mm paper, 32 on 58 mm (Font A).
 */
export function columnsOf(d: PrintDoc): number {
  return d.paper.paperMm === 58 ? 32 : 48;
}

function wrap(text: string, width: number, indent = ''): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if ([...indent, ...next].length > width && line) {
      out.push(indent + line);
      line = word;
    } else line = next;
  }
  if (line) out.push(indent + line);
  return out.length ? out : [indent];
}

const MARK = { plus: '+', no: '✕', note: '•' } as const;

function itemRows(i: PrintItem, width: number, struck = false): string[] {
  const rows = wrap(`${i.qty} × ${struck ? `~~${i.name}~~` : i.name}`, width);
  if (i.sub) rows.push(...wrap(i.sub, width, '    '));
  for (const m of i.mods) rows.push(...wrap(`${MARK[m.mark]} ${m.mark === 'plus' ? m.text : `**${m.text}**`}`, width, '    '));
  if (i.allergy) rows.push(...wrap(`⚠ **${i.allergy}**`, width, '    '));
  return rows;
}

/** Two ends of one line; on two lines when they don't fit together. */
function pair(a: string, b: string, width: number): string {
  const gap = width - [...a].length - [...b].length;
  if (gap < 1) return [a, ' '.repeat(Math.max(0, width - [...b].length)) + b].join('\n');
  return a + ' '.repeat(gap) + b;
}

function blockRows(b: Block, width: number): string[] {
  const center = (s: string) => ' '.repeat(Math.max(0, Math.floor((width - [...s].length) / 2))) + s;
  switch (b.t) {
    case 'band':
      return [`██ ${b.title}${b.sub ? ` · ${b.sub}` : ''} ██`];
    case 'head':
      return [pair(`${b.label} ${b.number}`, b.code ? `${b.code.label} ${b.code.value}` : b.ready ? `${b.ready.label} ${b.ready.time} ${b.ready.period}`.trim() : '', width), '='.repeat(width)];
    case 'facts':
      return wrap(b.parts.join(' · '), width);
    case 'alert':
      return wrap(`⚠ **${b.title}**${b.sub ? ` (${b.sub})` : ''}`, width);
    case 'note':
      return wrap(`[${b.label}: **${b.text}**]`, width);
    case 'who':
      return [`-- ${b.label}${b.count != null ? ` (${b.count})` : ''} --`, ...(b.note ? wrap(`**${b.note}**`, width) : [])];
    case 'item':
      return itemRows(b, width);
    case 'box':
      return [`[${b.title}]`, ...b.items.flatMap((i) => itemRows(i, width, b.tone === 'out'))];
    case 'count':
      return [b.text];
    case 'tear':
      return [`✂ ${b.text}`];
    case 'stub':
      return [
        pair(`${b.numberLabel} ${b.number}`, `${b.code.label} ${b.code.value ?? b.code.blank}`, width),
        b.money.kind === 'cash' ? `**${b.money.label} ${b.money.amount} ${b.money.unit}**` : b.money.text,
        pair(b.items, b.bag, width),
        ...(b.courier ? [b.courier] : []),
      ];
    case 'foot':
      return [pair(b.start, b.end, width)];
    case 'store':
      return [center(b.text)];
    case 'hello':
      return [center(b.text)];
    case 'meta':
      return [pair(`${b.label} ${b.number}`, b.when, width)];
    case 'double':
      return ['='.repeat(width)];
    case 'row':
      return [b.price ? pair(`${b.qty} ${b.name}`, b.price, width) : `${b.qty} ${b.name}`, ...(b.sub ? wrap(b.sub, width, '  ') : [])];
    case 'sum':
      return b.rows.map((r) => pair(r.label, r.value, width));
    case 'total':
      return [pair(`**${b.label}**`, `**${b.amount} ${b.unit}**`, width)];
    case 'stamp':
      return b.kind === 'cash' ? [center(`(( ${b.top} ${b.amount} ${b.unit} ))`)] : [center(`[ ${b.text} ]`)];
    case 'help':
      return wrap(b.text, width);
    case 'gift':
      return [center(b.title), ...(b.line ? wrap(b.line, width) : []), ...wrap(b.from, width)];
    case 'station':
      return [pair(`██ ${b.name}`, b.part, width)];
    case 'pack':
      return [`☐ ${b.qty} ${b.name} (${b.station})`];
    case 'cup':
      return [pair(b.number, b.part, width), `**${b.name}**`, ...(b.mods ? [b.mods] : []), '- '.repeat(Math.floor(width / 2))];
    case 'ruler':
      return b.bars.map((r) => `${'█'.repeat(Math.round((r.dots / 576) * width) - [...r.label].length - 1)} ${r.label}`);
    case 'text':
      return wrap(b.strong ? `**${b.text}**` : b.text, width);
  }
}

export function toPlainText(d: PrintDoc): string {
  const width = columnsOf(d);
  return d.blocks
    .flatMap((b) => blockRows(b, width))
    .join('\n');
}
