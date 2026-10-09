import { useSyncExternalStore } from 'react';
import { storage as platformStorage, type KeyValueStorage } from '@/lib/storage';
import { isPrinterDots, type PrinterDots } from './paper';

/**
 * The kitchen printer's settings, per device (the printer is the tablet's). Defaults follow Ali's
 * 2026-10-08 calls: a customer slip in every bag (k1), the bag stub on, 80 mm until the calibration
 * ticket says otherwise (k5). Beep and cut only do something on printers that have them (i28, i29).
 */
export interface PrintSettings {
  /** Printer head width, from «اطبع مسطرة» (i27). */
  dots: PrinterDots;
  /** Customer slip in the bag (k1). */
  slip: boolean;
  /** Tear-off bag stub under the kitchen ticket (i09). */
  stub: boolean;
  /** Kitchen tickets per order (a second one for a two-cook kitchen). */
  copies: 1 | 2;
  /** Buzzer on a new ticket (i28). */
  beep: boolean;
  /** Cut after each ticket (i29). */
  cut: boolean;
  /** Dishes per bag for «كيس 1 من 2» (i10). */
  itemsPerBag: number;
  /** One ticket per station + a packing ticket (i19). */
  stations: boolean;
  /** Menu sections that go to the tea / cold-drinks counter (i19, i20). */
  drinkSections: string[];
  /** A cup label for each drink (i20); a café's default. */
  cups: boolean | null;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = { dots: 576, slip: true, stub: true, copies: 1, beep: true, cut: true, itemsPerBag: 12, stations: false, drinkSections: [], cups: null };

export const ITEMS_PER_BAG_CHOICES = [6, 12, 20] as const;

const KEY = 'driver.merchant.printer';

export function parsePrintSettings(raw: string | null): PrintSettings {
  let v: Partial<PrintSettings> = {};
  try {
    if (raw) v = JSON.parse(raw) as Partial<PrintSettings>;
  } catch {
    v = {};
  }
  const d = DEFAULT_PRINT_SETTINGS;
  return {
    dots: isPrinterDots(v.dots) ? v.dots : d.dots,
    slip: typeof v.slip === 'boolean' ? v.slip : d.slip,
    stub: typeof v.stub === 'boolean' ? v.stub : d.stub,
    copies: v.copies === 2 ? 2 : 1,
    beep: typeof v.beep === 'boolean' ? v.beep : d.beep,
    cut: typeof v.cut === 'boolean' ? v.cut : d.cut,
    itemsPerBag: typeof v.itemsPerBag === 'number' && v.itemsPerBag >= 1 && v.itemsPerBag <= 50 ? Math.round(v.itemsPerBag) : d.itemsPerBag,
    stations: v.stations === true,
    drinkSections: Array.isArray(v.drinkSections) ? v.drinkSections.filter((s): s is string => typeof s === 'string').slice(0, 30) : [],
    cups: typeof v.cups === 'boolean' ? v.cups : null,
  };
}

/** Cup labels: what the shop chose, else on for a drinks shop (café, juice bar) only. */
export function cupsOn(s: PrintSettings, prepKind: 'food' | 'drinks' | undefined): boolean {
  return s.cups ?? prepKind === 'drinks';
}

export function createPrintSettingsStore(store: KeyValueStorage) {
  let state: PrintSettings = DEFAULT_PRINT_SETTINGS;
  let loading: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: PrintSettings) => {
    state = next;
    for (const l of listeners) l();
  };
  return {
    getSnapshot: () => state,
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    load(): Promise<void> {
      loading ??= (async () => {
        let raw: string | null = null;
        try {
          raw = await store.getItem(KEY);
        } catch {
          raw = null;
        }
        emit(parsePrintSettings(raw));
      })();
      return loading;
    },
    async set(patch: Partial<PrintSettings>) {
      const next = parsePrintSettings(JSON.stringify({ ...state, ...patch }));
      emit(next);
      await store.setItem(KEY, JSON.stringify(next)).catch(() => {});
    },
  };
}

export const printSettings = createPrintSettingsStore(platformStorage);

export function usePrintSettings(): PrintSettings {
  return useSyncExternalStore(printSettings.subscribe, printSettings.getSnapshot, printSettings.getSnapshot);
}
