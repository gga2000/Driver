import type { Receipt, ReceiptLine } from './receipt';

/**
 * The ticket as a standalone 80 mm HTML page for the browser's print dialog (web/dev only). RTL,
 * IBM Plex Sans Arabic when installed, black on white, bold notes.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function line(l: ReceiptLine): string {
  switch (l.kind) {
    case 'title':
      return `<div class="title">${esc(l.text)}</div>`;
    case 'number':
      return `<div class="number">${esc(l.text)}</div>`;
    case 'meta':
      return `<div class="meta">${esc(l.text)}</div>`;
    case 'payment':
      return `<div class="payment${l.cash ? ' cash' : ''}">${esc(l.text)}</div>`;
    case 'person':
      return `<div class="person">${esc(l.text)}</div>${l.note ? `<div class="pnote">${esc(l.note)}</div>` : ''}`;
    case 'item':
      return `<div class="item${l.removed ? ' removed' : ''}"><span class="qty">${l.qty}×</span><span>${esc(l.name)}</span></div>${
        l.modifiers.length ? `<div class="mods">${esc(l.modifiers.join(' · '))}</div>` : ''
      }${l.note ? `<div class="inote">${esc(l.note)}</div>` : ''}`;
    case 'note':
      return `<div class="onote">${esc(l.text)}</div>`;
    case 'total':
      return `<div class="total"><span>${esc(l.label)}</span><span>${esc(l.value)}</span></div>`;
    case 'divider':
      return '<hr/>';
    case 'footer':
      return `<div class="footer">${esc(l.text)}</div>`;
  }
}

export function receiptHtml(r: Receipt): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>${esc(r.number)}</title><style>
@page { size: 80mm auto; margin: 4mm; }
body { font-family: "IBM Plex Sans Arabic", "Noto Naskh Arabic", sans-serif; color: #000; width: 72mm; margin: 0; font-size: 13px; line-height: 1.5; }
.title { text-align: center; font-weight: 700; font-size: 16px; }
.number { text-align: center; font-weight: 700; font-size: 30px; margin: 2px 0; }
.meta, .footer { text-align: center; font-size: 12px; }
.payment { text-align: center; margin-top: 4px; }
.payment.cash { font-weight: 700; border: 1.5px solid #000; padding: 2px 4px; }
.person { font-weight: 700; margin-top: 6px; background: #000; color: #fff; padding: 1px 4px; }
.pnote, .inote, .onote { font-weight: 700; }
.item { display: flex; gap: 6px; font-size: 15px; font-weight: 600; margin-top: 3px; }
.item.removed { text-decoration: line-through; opacity: .6; }
.qty { min-width: 28px; font-weight: 700; }
.mods, .inote { padding-inline-start: 34px; font-size: 12px; }
.total { display: flex; justify-content: space-between; font-weight: 700; }
hr { border: 0; border-top: 1.5px dashed #000; margin: 6px 0; }
</style></head><body>${r.lines.map(line).join('')}</body></html>`;
}
