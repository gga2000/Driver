import { useMemo } from 'react';
import { hour12, hourPeriod, localParts, relativeDay } from './calendar';
import { useT, type TKey } from './i18n';
import { clock12 } from './time';

export interface Dates {
  /** "3 تشرين الأول" */
  dayMonth: (at: Date | number) => string;
  /** "اليوم" / "البارحة" / "الخميس 1 تشرين الأول" */
  day: (at: Date | number, now: number) => string;
  /** "اليوم، الساعة 9:41" */
  when: (at: Date | number, now: number) => string;
  /** "السبت" */
  dow: (dow: number) => string;
  /** "9 بالليل" */
  hour: (hour: number) => string;
}

/** Localised Baghdad dates for the money and insights screens. */
export function useDates(): Dates {
  const t = useT();
  return useMemo(() => {
    const dayMonth = (at: Date | number) => {
      const p = localParts(at);
      return t('merchant.date.day_month', { day: p.day, month: t(`merchant.date.month_${p.month}` as TKey) });
    };
    const dow = (d: number) => t(`merchant.date.dow_${d}` as TKey);
    const day = (at: Date | number, now: number) => {
      const rel = relativeDay(at, now);
      if (rel === 'today') return t('merchant.date.today');
      if (rel === 'yesterday') return t('merchant.date.yesterday');
      return `${dow(localParts(at).dow)} ${dayMonth(at)}`;
    };
    return {
      dayMonth,
      day,
      dow,
      when: (at, now) => t('merchant.date.at', { day: day(at, now), time: clock12(at) }),
      hour: (h) => t('merchant.time.hour', { hour: hour12(h), period: t(`merchant.time.${hourPeriod(h)}` as TKey) }),
    };
  }, [t]);
}
