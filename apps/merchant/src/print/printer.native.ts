import type { Receipt } from './receipt';
import { PrinterUnsupportedError, type PrinterDriver, type PrinterSnapshot } from './types';

export { previewQueue } from './preview-queue';

/**
 * Bluetooth ESC/POS driver for the kitchen tablet — stubbed behind the shared `PrinterDriver`
 * interface until the dev-client build ships a BLE module.
 *
 * TODO(native-print):
 *  1. Add a BLE module (react-native-ble-plx) to a dev-client build; scan for printers advertising
 *     the common serial service (0x18F0 / 0xFFE0), remember the chosen device id in prefs.
 *  2. Arabic: cheap 80 mm ESC/POS printers have no Arabic shaping or RTL, so render the `Receipt`
 *     to a 576-px-wide monochrome bitmap (react-native-view-shot of <ReceiptPaper/>, then dither)
 *     and send it with `GS v 0`; cut with `GS V 1`.
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
    async print(_receipt: Receipt) {
      throw new PrinterUnsupportedError('bluetooth printing');
    },
  };
}

export function printInBrowser(_receipt: Receipt): void {
  /* native has no browser print dialog */
}
