import { DISH_KINDS, type DishKind } from '@driver/contracts';

/**
 * k4/j6: the owner's ticket kind lives in the dish's `labels` column as `kind:<value>` (no migration).
 * Kept here, not in the contracts barrel, so the apps that never read it don't carry it.
 */
const KIND_PREFIX = 'kind:';

/** The owner's ticket kind kept in a dish's stored labels, or null when he left it to the guess. */
export function kindOfLabels(labels: readonly string[] | null | undefined): DishKind | null {
  for (const l of labels ?? []) {
    if (!l.startsWith(KIND_PREFIX)) continue;
    const k = l.slice(KIND_PREFIX.length);
    if ((DISH_KINDS as readonly string[]).includes(k)) return k as DishKind;
  }
  return null;
}

/** Stored labels with the ticket kind set (or cleared with null); the other labels stay as they are. */
export function withKind(labels: readonly string[], kind: DishKind | null): string[] {
  const rest = labels.filter((l) => !l.startsWith(KIND_PREFIX));
  return kind ? [...rest, `${KIND_PREFIX}${kind}`] : rest;
}
