import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { BoardOrder, PrinterState } from '@driver/contracts';
import { useCounterToast } from '@/lib/toast';
import { useLocale, useT } from '@/lib/i18n';
import { clock12 } from '@/lib/time';
import { createPrinter } from '@/print/printer';
import { previewQueue } from '@/print/preview-queue';
import type { PrintJob } from '@/print/doc';
import { printJournal } from '@/print/journal';
import { snapLines } from '@/print/kitchen';
import { autoPrintWhen, catchUpDue, planChangeJob, planOrderJob, printsOnScreen } from '@/print/plan';
import { printSettings, usePrintSettings, type PrintSettings } from '@/print/settings';
import type { PrinterSnapshot } from '@/print/types';
import type { PrintCtx } from '@/print/context';
import { useMenu } from '@/features/menu/queries';
import { useStoreSwitches } from '@/features/store/queries';

/** The device's one printer driver (web preview, or Bluetooth on the tablet). */
export const printer = createPrinter();

void printSettings.load();
void printJournal.load();

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

export interface StorePrint {
  orgId: string | null;
  name: string;
  prepKind?: 'food' | 'drinks' | undefined;
}

/** Dish name → its menu section, for stations and cup labels (only read when the shop uses them). */
function useSections(orgId: string | null, settings: PrintSettings): ((name: string) => string | null) | undefined {
  const wanted = settings.drinkSections.length > 0;
  const menu = useMenu(wanted ? orgId : null);
  return useMemo(() => {
    if (!wanted || !menu.data) return undefined;
    const map = new Map<string, string>();
    for (const c of menu.data.categories) for (const i of c.items) if (c.nameAr) map.set(i.nameAr, c.nameAr);
    return (name: string) => map.get(name) ?? null;
  }, [wanted, menu.data]);
}

/** Builds the print context (words, store, time of printing) in the current language. */
export function usePrintCtx(storeName: string): () => Omit<PrintCtx, 'paper'> {
  const t = useT();
  const locale = useLocale();
  return useCallback(() => ({ t, locale, storeName, now: new Date() }), [t, locale, storeName]);
}

/** The job for an order as it would print now on this device (reprint band included). */
export function useOrderJob(store: StorePrint) {
  const ctx = usePrintCtx(store.name);
  const settings = usePrintSettings();
  const sectionOf = useSections(store.orgId, settings);
  return useCallback(
    (o: BoardOrder, opts: { fresh?: boolean } = {}): PrintJob => {
      const rec = opts.fresh ? null : printJournal.get(o.id);
      return planOrderJob({ order: o, ctx: ctx(), settings, ...(store.prepKind ? { prepKind: store.prepKind } : {}), ...(sectionOf ? { sectionOf } : {}), previous: rec });
    },
    [ctx, settings, sectionOf, store.prepKind],
  );
}

/**
 * "اطبع": prints the order on the tablet's printer (a second press says «نسخة ثانية», i13); the
 * browser opens the true-size preview instead. `auto` = printed by itself after accepting.
 */
export function usePrintOrder(store: StorePrint) {
  const toast = useCounterToast();
  const t = useT();
  const jobFor = useOrderJob(store);
  return useCallback(
    async (o: BoardOrder, opts: { auto?: boolean } = {}) => {
      const job = jobFor(o);
      if (printsOnScreen(printer.getSnapshot())) {
        if (opts.auto) toast.show({ message: t('merchant.printer.chip_preview'), tone: 'neutral', icon: 'receipt', action: { label: t('merchant.detail.receipt'), onPress: () => previewQueue.show(job) } });
        else {
          printJournal.printed(o.id, snapLines(o), Date.now());
          previewQueue.show(job);
        }
        return;
      }
      try {
        await printer.print(job);
        printJournal.printed(o.id, snapLines(o), Date.now());
        toast.show({ message: t('merchant.printer.printed'), tone: 'success' });
      } catch {
        toast.show({ message: t('merchant.printer.failed'), tone: 'danger', action: { label: t('merchant.detail.receipt'), onPress: () => previewQueue.show(job) } });
      }
    },
    [jobFor, toast, t],
  );
}

/** Orders accepted on this device that still have to print by themselves (module-level: survives re-renders). */
const waiting = new Map<string, { told: 'none' | 'partial' | 'scheduled' }>();
/** Orders this device already took for printing this session (the journal keeps only the last few). */
const takenHere = new Set<string>();

/** After an accept on this device: print once the order is really ready to cook (see `autoPrintWhen`). */
export function queueAutoPrint(orderId: string) {
  waiting.set(orderId, { told: 'none' });
}

/**
 * The board's printing loop. Accepted orders print when their time comes: at once, after the
 * customer answers a partial accept (i16), or at the start-cooking time of a scheduled order with the
 * «مجدول» band (i17). An order this device already printed whose dishes changed prints a short
 * «تعديل» ticket with only the change (i14).
 */
export function useAutoPrint(orders: readonly BoardOrder[], store: StorePrint, enabled: boolean, now: number) {
  const print = usePrintOrder(store);
  const ctx = usePrintCtx(store.name);
  const settings = usePrintSettings();
  const toast = useCounterToast();
  const t = useT();
  const busy = useRef(false);
  const snap = usePrinterSnapshot();
  const printerReady = snap.kind !== 'preview' && snap.connection === 'connected';
  useEffect(() => {
    if (!enabled || busy.current) return;
    const due: BoardOrder[] = [];
    const changes: PrintJob[] = [];
    for (const o of orders) {
      const w = waiting.get(o.id);
      if (w) {
        const when = autoPrintWhen(o, now);
        if (when.kind === 'now') {
          waiting.delete(o.id);
          takenHere.add(o.id);
          due.push(o);
        } else if (when.kind === 'wait' && o.partial && w.told !== 'partial') {
          w.told = 'partial';
          toast.show({ message: t('merchant.printer.waits_customer'), tone: 'neutral', icon: 'receipt' });
        } else if (when.kind === 'at' && w.told !== 'scheduled') {
          w.told = 'scheduled';
          toast.show({ message: t('merchant.printer.scheduled_at', { time: clock12(when.at) }), tone: 'neutral', icon: 'clock' });
        }
        continue;
      }
      const rec = printJournal.get(o.id);
      // MER-11: the counter's printer also prints what other devices accepted.
      if (catchUpDue(o, now, { printerReady, printedBefore: !!rec || takenHere.has(o.id) })) {
        takenHere.add(o.id);
        due.push(o);
        continue;
      }
      if (!rec || o.column === 'ready' || o.partial) continue;
      const job = planChangeJob(o, rec.lines, ctx(), settings);
      if (job) {
        printJournal.changed(o.id, snapLines(o));
        changes.push(job);
      }
    }
    // Gone from the board (cancelled, picked up): nothing left to print.
    for (const id of waiting.keys()) if (!orders.some((o) => o.id === id)) waiting.delete(id);
    if (!due.length && !changes.length) return;
    busy.current = true;
    void (async () => {
      for (const o of due) await print(o, { auto: true });
      for (const job of changes) {
        if (printsOnScreen(printer.getSnapshot())) toast.show({ message: t('merchant.ticket.change'), tone: 'neutral', icon: 'receipt', action: { label: t('merchant.detail.receipt'), onPress: () => previewQueue.show(job) } });
        else await printer.print(job).then(
          () => toast.show({ message: t('merchant.printer.printed_change'), tone: 'success' }),
          () => toast.show({ message: t('merchant.printer.failed'), tone: 'danger', action: { label: t('merchant.detail.receipt'), onPress: () => previewQueue.show(job) } }),
        );
      }
      busy.current = false;
    })();
  }, [orders, enabled, now, print, ctx, settings, toast, t, printerReady]);
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
