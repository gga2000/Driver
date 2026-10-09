import type { PrintJob } from './doc';
import { PrinterUnsupportedError, type PrinterDriver, type PrinterSnapshot } from './types';

export { previewQueue } from './preview-queue';

/**
 * Bluetooth ESC/POS driver for the kitchen tablet — stubbed behind the shared `PrinterDriver`
 * interface until the dev-client build ships a BLE module.
 *
 * TODO(native-print):
 *  1. Add a BLE module (react-native-ble-plx) to a dev-client build; scan for printers advertising
 *     the common serial service (0x18F0 / 0xFFE0), remember the chosen device id in prefs.
 *  2. Arabic: cheap ESC/POS printers have no Arabic shaping or RTL, so draw each `PrintDoc` with
 *     <PaperDoc pxPerMm={8}/> at the head's width (384/512/576 dots, `printSettings.dots`), capture it
 *     (react-native-view-shot), and send `jobBytes()` from escpos.ts: 1-bit strips with `GS v 0`, a
 *     beep first and a partial cut after each document when the settings say so.
 *  3. Report connection changes with `merchant.setPrinterStatus` (the board's "الطابعة مفصولة"
 *     marker and dispatch read it) — `usePrinterSync` in features/print already does this for any
 *     driver whose snapshot changes.
 * Until then the tablet behaves as "no printer" and every ticket opens the on-screen preview.
 */

let snapshot: PrinterSnapshot = { kind: 'bluetooth', connection: 'not_set_up', name: null };
const listeners = new Set<() => void>();

export function createPrinter(): PrinterDriver {
  return {
    kind: 'bluetooth',
    getSnapshot: () => snapshot,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    async connect() {
      throw new PrinterUnsupportedError('bluetooth pairing');
    },
    async disconnect() {
      snapshot = { ...snapshot, connection: 'not_set_up' };
      for (const l of listeners) l();
      return snapshot;
    },
    async print(_job: PrintJob) {
      throw new PrinterUnsupportedError('bluetooth printing');
    },
  };
}

export function printInBrowser(_job: PrintJob): void {
  /* native has no browser print dialog */
}
