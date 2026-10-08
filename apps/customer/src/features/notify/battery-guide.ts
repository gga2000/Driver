/**
 * CRIT3-01: phones whose battery manager stops apps in the background (Xiaomi, Oppo/Realme, Tecno/
 * Infinix, Huawei, Samsung), so order pushes arrive late or never. Each family has its own way to let
 * درايفر run; the notifications screen shows the steps for this phone only.
 */
export type BatteryFamily = 'xiaomi' | 'oppo' | 'transsion' | 'huawei' | 'samsung';

const FAMILIES: ReadonlyArray<[BatteryFamily, readonly string[]]> = [
  ['xiaomi', ['xiaomi', 'redmi', 'poco']],
  ['oppo', ['oppo', 'realme', 'oneplus']],
  ['transsion', ['tecno', 'infinix', 'itel']],
  ['huawei', ['huawei', 'honor']],
  ['samsung', ['samsung']],
];

/** The battery family of a maker/brand name, or null when its battery manager leaves apps alone. */
export function batteryFamily(maker: string | null | undefined): BatteryFamily | null {
  const m = (maker ?? '').trim().toLowerCase();
  if (!m) return null;
  return FAMILIES.find(([, names]) => names.some((n) => m.includes(n)))?.[0] ?? null;
}

/** The three steps for a family, as locale keys (`notify.battery.<family>_1..3`). */
export function batterySteps(family: BatteryFamily): readonly [`notify.battery.${BatteryFamily}_1`, `notify.battery.${BatteryFamily}_2`, `notify.battery.${BatteryFamily}_3`] {
  return [`notify.battery.${family}_1`, `notify.battery.${family}_2`, `notify.battery.${family}_3`];
}
