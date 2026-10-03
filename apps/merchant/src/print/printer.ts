import { previewQueue } from './preview-queue';
import type { Receipt } from './receipt';
import { receiptHtml } from './receipt-html';
import type { PrinterDriver, PrinterSnapshot } from './types';

/**
 * Web / dev printer: every ticket opens the on-screen 80 mm preview (ReceiptPreview listens to
 * `previewQueue`), and the preview's "اطبع" sends it to the browser's print dialog through a hidden
 * iframe sized for 80 mm paper. Always "connected": there is nothing to pair.
 */

export { previewQueue } from './preview-queue';

const SNAPSHOT: PrinterSnapshot = { kind: 'preview', connection: 'connected', name: null };

export function createPrinter(): PrinterDriver {
  return {
    kind: 'preview',
    getSnapshot: () => SNAPSHOT,
    subscribe: () => () => {},
    connect: async () => SNAPSHOT,
    disconnect: async () => SNAPSHOT,
    async print(receipt) {
      previewQueue.show(receipt);
    },
  };
}

/** Sends a ticket to the browser's print dialog (80 mm page). No-op outside a browser. */
export function printInBrowser(receipt: Receipt): void {
  if (typeof document === 'undefined') return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0', insetInlineEnd: '0', bottom: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(receiptHtml(receipt));
  doc.close();
  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 50);
}
