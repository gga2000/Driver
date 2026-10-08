import type { CatalogToday } from '@driver/contracts';
import type { TFn } from '@/lib/i18n';

/** Iraqi count + noun agreement: 1 واحد, 2 dual, 3–10 plural, 11+ singular (voice guide §5). */
export function countPhrase(n: number, noun: 'restaurants' | 'cars', t: TFn): string {
  if (n === 1) return t(`welcome_map.${noun}_one`);
  if (n === 2) return t(`welcome_map.${noun}_two`);
  if (n <= 10) return t(`welcome_map.${noun}_few`, { count: n });
  return t(`welcome_map.${noun}_many`, { count: n });
}

/** "اليوم: 4 مطاعم مفتوحة · 6 سيارات للرجعة" — only what is true right now; nothing when nothing is. */
export function todayLine(today: CatalogToday | undefined, t: TFn): string | null {
  if (!today) return null;
  const parts: string[] = [];
  if (today.openRestaurants > 0) parts.push(countPhrase(today.openRestaurants, 'restaurants', t));
  if (today.rajaaCarsToday > 0) parts.push(countPhrase(today.rajaaCarsToday, 'cars', t));
  return parts.length > 0 ? t('welcome_map.today', { parts: parts.join(' · ') }) : null;
}

/** The short live pill on the welcome photo: "هسة 8 مطاعم مفتوحة". Nothing when no kitchen is open. */
export function nowLine(today: CatalogToday | undefined, t: TFn): string | null {
  if (!today || today.openRestaurants <= 0) return null;
  return t('welcome.now', { parts: countPhrase(today.openRestaurants, 'restaurants', t) });
}
