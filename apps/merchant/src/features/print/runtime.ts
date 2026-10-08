import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { BoardOrder, PrinterState } from '@driver/contracts';
import { useCounterToast } from '@/lib/toast';
import { useLocale, useT } from '@/lib/i18n';
import { iqd } from '@/lib/money';
import { createPrinter } from '@/print/printer';
import { previewQueue } from '@/print/preview-queue';
import { buildReceipt, type Receipt } from '@/print/receipt';
import type { PrinterSnapshot } from '@/print/types';
import { useStoreSwitches } from '@/features/store/queries';

/** The device's one printer driver (web preview, or Bluetooth on the tablet). */
export const printer = createPrinter();

export function usePrinterSnapshot(): PrinterSnapshot {
  return useSyncExternalStore(printer.subscribe, printer.getSnapshot, printer.getSnapshot);
}

/**
 * What the printer chip says: a real driver's live state; for the browser preview, what the store's
 * tablet last reported (so the web board also shows "الطابعة مفصولة"), else "معاينة الطباعة".
 */
export function printerChipState(snapshot: PrinterSnapshot, server: PrinterState | undefined): PrinterState | 'preview' {
  if (snapshot.kind === 'preview') return server && server !== 'not_set_up' ? server : 'preview';
  return snapshot.connection;
}

/** Builds the ticket for an order in the current language. */
export function useReceipt(storeName: string) {
  const t = useT();
  const locale = useLocale();
  return useCallback((o: BoardOrder): Receipt => buildReceipt(o, { storeName, t, money: (n) => iqd(n, { locale }) }), [storeName, t, locale]);
}

/** "اطبع": prints on the tablet's printer; the browser opens the 80 mm preview instead. */
export function usePrintOrder(storeName: string) {
  const toast = useCounterToast();
  const t = useT();
  const receipt = useReceipt(storeName);
  return useCallback(
    async (o: BoardOrder, opts: { auto?: boolean } = {}) => {
      const r = receipt(o);
      if (printer.kind === 'preview') {
        if (opts.auto) toast.show({ message: t('merchant.printer.chip_preview'), tone: 'neutral', icon: 'receipt', action: { label: t('merchant.detail.receipt'), onPress: () => previewQueue.show(r) } });
        else previewQueue.show(r);
        return;
      }
      try {
        await printer.print(r);
        toast.show({ message: t('merchant.printer.printed'), tone: 'success' });
      } catch {
        toast.show({ message: t('merchant.printer.failed'), tone: 'danger', action: { label: t('merchant.detail.receipt'), onPress: () => previewQueue.show(r) } });
      }
    },
    [receipt, toast, t],
  );
}

/** Reports a real printer's connection changes to the server (the board marker and dispatch read it). */
export function usePrinterSync(merchantOrgId: string | null) {
  const snap = usePrinterSnapshot();
  const { setPrinterStatus } = useStoreSwitches();
  const last = useRef<string | null>(null);
  const mutate = setPrinterStatus.mutate;
  useEffect(() => {
    if (!merchantOrgId || snap.kind === 'preview' || snap.connection === 'not_set_up') return;
    const key = `${merchantOrgId}:${snap.connection}`;
    if (last.current === key) return;
    last.current = key;
    mutate({ merchantOrgId, state: snap.connection, ...(snap.name ? { name: snap.name } : {}) });
  }, [merchantOrgId, snap, mutate]);
}
