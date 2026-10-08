import { previewQueue } from './preview-queue';
import type { PrintJob } from './doc';
import { jobHtml } from './doc-html';
import type { PrinterDriver, PrinterSnapshot } from './types';

/**
 * Web / dev printer: every job opens the on-screen true-size preview (ReceiptPreview listens to
 * `previewQueue`), and the preview's "اطبع" sends it to the browser's print dialog through a hidden
 * iframe sized for the paper. Always "connected": there is nothing to pair.
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
    async print(job) {
      previewQueue.show(job);
    },
  };
}

/**
 * The app's own font files as `@font-face` rules (fonts.web.ts aliases them as "IBM Plex Sans Arabic"
 * and "Alexandria"), so the print page carries its fonts instead of falling back to the PC's.
 */
export function bundledFontCss(): string {
  if (typeof document === 'undefined') return '';
  return document.getElementById('driver-font-alias')?.textContent ?? '';
}

/** Sends a job to the browser's print dialog (one page per document). No-op outside a browser. */
export function printInBrowser(job: PrintJob): void {
  if (typeof document === 'undefined') return;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0', insetInlineEnd: '0', bottom: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.open();
  doc.write(jobHtml(job, { fontCss: bundledFontCss() }));
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };
  // Wait for the fonts inside the frame, or the first print comes out in a fallback face.
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts) void fonts.ready.then(() => setTimeout(go, 50), () => setTimeout(go, 50));
  else setTimeout(go, 50);
}
