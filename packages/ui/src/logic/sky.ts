import type { SkyHour } from '@driver/design-tokens';

/** Which sky an hour in town has at the top of home: dawn 4–11, noon 11–16, sunset 16–19, late after. */
export function skyHour(hour: number): SkyHour {
  if (hour >= 4 && hour < 11) return 'dawn';
  if (hour >= 11 && hour < 16) return 'noon';
  if (hour >= 16 && hour < 19) return 'sunset';
  return 'late';
}

/**
 * The plate colour for a dish or kitchen (`decor.stages`): picked from its id, so the same dish keeps
 * its plate everywhere and neighbours rarely match.
 */
export function stageOf(id: string, stages: readonly string[]): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return stages[h % Math.max(1, stages.length)] ?? stages[0] ?? 'transparent';
}
