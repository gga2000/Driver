import type { PrintJob } from './doc';

/**
 * One interface for every receipt printer. `printer.ts` (web/dev) shows an on-screen true-size preview
 * and can hand it to the browser's print dialog; `printer.native.ts` is the Bluetooth ESC/POS driver
 * for the tablet (stubbed until the dev-client build ships a BLE module).
 */
export type PrinterKind = 'preview' | 'bluetooth';
export type PrinterConnection = 'connected' | 'disconnected' | 'not_set_up';

export interface PrinterSnapshot {
  kind: PrinterKind;
  connection: PrinterConnection;
  name: string | null;
}

export interface PrinterDriver {
  readonly kind: PrinterKind;
  getSnapshot(): PrinterSnapshot;
  subscribe(listener: () => void): () => void;
  /** Pair/connect (Bluetooth) — the preview printer is always "connected". */
  connect(): Promise<PrinterSnapshot>;
  disconnect(): Promise<PrinterSnapshot>;
  /** Prints (or previews) one job: its documents in order, beep and cuts as the job says. Rejects when the printer is unreachable. */
  print(job: PrintJob): Promise<void>;
}

/** Thrown by drivers that cannot do something on this platform yet. */
export class PrinterUnsupportedError extends Error {
  constructor(what: string) {
    super(`printer: ${what} is not supported on this build`);
    this.name = 'PrinterUnsupportedError';
  }
}
