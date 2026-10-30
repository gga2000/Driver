import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import type { HomeSlots, MenuItem } from '@driver/contracts';
import { Button, ModalSheet, Skeleton, Stepper, Text, useTheme } from '@driver/ui';
import { MAX_CONTENT_WIDTH } from '@/components/Screen';
import { FoodArt, artOf } from '@/features/food/FoodArt';
import { servesCopy } from '@/features/food/portions';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import { dayChip, dayLeft, firstOpenSlot, slotWhen } from './format';
import { PortionPill, usePom } from './parts';
import { useHomeSlots } from './queries';

type Day = HomeSlots['days'][number];

export interface ReserveSheetProps {
  merchantId: string;
  item: MenuItem;
  now: Date;
  onClose: () => void;
  /** The customer picked a time and plates: the screen puts it in the cart. */
  onBook: (pick: { at: Date; qty: number }) => void;
}

/**
 * «احجز» (v3): pick the day she cooks it, the pickup time (each says the plates still free; a full one
 * reads «انحجز»), how many plates, and book — the order is an ordinary pre-order at that time. The
 * times are read fresh every time the sheet opens.
 */
export function ReserveSheet({ merchantId, item, now, onClose, onBook }: ReserveSheetProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const pom = usePom();
  const slots = useHomeSlots(merchantId, item.id);
  const days = useMemo(() => slots.data?.days ?? [], [slots.data]);
  const [dayIdx, setDayIdx] = useState<number | null>(null);
  const [slotMs, setSlotMs] = useState<number | null>(null);
  const [qty, setQty] = useState(1);

  // Start on the first day and time with a plate free.
  useEffect(() => {
    if (dayIdx !== null || days.length === 0) return;
    const first = days.findIndex((d) => dayLeft(d.slots) > 0);
    const i = Math.max(0, first);
    setDayIdx(i);
    const s = firstOpenSlot(days[i]!.slots);
    setSlotMs(s && s.left > 0 ? s.at.getTime() : null);
  }, [days, dayIdx]);

  const day: Day | null = dayIdx !== null ? (days[dayIdx] ?? null) : null;
  const slot = day?.slots.find((s) => s.at.getTime() === slotMs) ?? null;
  const maxQty = slot ? Math.max(1, slot.left) : 1;
  useEffect(() => setQty((q) => Math.min(q, maxQty)), [maxQty]);

  const serves = servesCopy(item.serves, locale);
  const portion = [serves ? t(serves.key, 'params' in serves ? serves.params : undefined) : null, item.portion ?? null].filter(Boolean).join(' · ');
  const when = slot ? slotWhen(slot.at, now) : null;
  const total = item.priceIqd * qty;
  const pickDay = (i: number) => {
    theme.haptic('selection');
    setDayIdx(i);
    const s = firstOpenSlot(days[i]!.slots);
    setSlotMs(s && s.left > 0 ? s.at.getTime() : null);
  };

  let body: React.ReactNode;
  if (slots.isError && !slots.data) {
    body = (
      <View style={{ gap: theme.space[3], alignItems: 'flex-start' }} testID="reserve-error">
        <Text variant="body">{t('home_food.slots_failed')}</Text>
        <Button size="sm" variant="secondary" label={t('home_food.retry')} onPress={() => void slots.refetch()} />
      </View>
    );
  } else if (!slots.data) {
    body = (
      <View style={{ gap: theme.space[3] }} testID="reserve-loading">
        <Skeleton height={16} width="30%" />
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} width={72} radius={theme.radius.xl} />
          ))}
        </View>
        <Skeleton height={64} radius={theme.radius.xl} />
      </View>
    );
  } else if (days.every((d) => dayLeft(d.slots) === 0)) {
    body = (
      <Text variant="body" color="textMuted" testID="reserve-none">
        {t('home_food.slots_none')}
      </Text>
    );
  } else {
    body = (
      <View style={{ gap: theme.space[5] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" weight={700} color="textMuted">
            {t('home_food.sheet_day')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} testID="reserve-days">
            {days.map((d, i) => {
              const chip = dayChip(d, now);
              const full = dayLeft(d.slots) === 0;
              const on = i === dayIdx;
              return (
                <Pressable
                  key={d.day}
                  testID={`reserve-day-${d.day}`}
                  accessibilityRole="radio"
                  aria-checked={on}
                  accessibilityLabel={`${t(chip.label.key, chip.label.params)} ${chip.date}${full ? `، ${t('home_food.day_full')}` : ''}`}
                  disabled={full}
                  onPress={() => pickDay(i)}
                  style={{
                    width: 72,
                    minHeight: 72,
                    borderRadius: theme.radius.xl,
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    backgroundColor: on ? pom.fill : theme.colors.surface,
                    borderWidth: 1.5,
                    borderStyle: full ? 'dashed' : 'solid',
                    borderColor: on ? pom.fill : theme.colors.border,
                  }}
                >
                  <Text variant="caption" weight={600} color={on ? pom.on : full ? 'textMuted' : 'text'} compact>
                    {t(chip.label.key, chip.label.params)}
                  </Text>
                  <Text variant="title" face="display" fixed color={on ? pom.on : full ? 'textMuted' : 'text'} tabular>
                    {String(chip.date)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {day ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="label" weight={700} color="textMuted">
              {t('home_food.sheet_time', { day: t(dayChip(day, now).label.key, dayChip(day, now).label.params) })}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} testID="reserve-times">
              {day.slots.map((s) => {
                const full = s.left === 0;
                const on = s.at.getTime() === slotMs;
                return (
                  <Pressable
                    key={s.at.getTime()}
                    testID={`reserve-slot-${s.at.getTime()}`}
                    accessibilityRole="radio"
                    aria-checked={on}
                    disabled={full}
                    accessibilityLabel={`${slotWhen(s.at, now).time}، ${full ? t('home_food.slot_full') : t('home_food.slot_left', { n: s.left })}`}
                    onPress={() => {
                      theme.haptic('selection');
                      setSlotMs(s.at.getTime());
                    }}
                    style={{
                      flexGrow: 1,
                      flexBasis: '30%',
                      minHeight: 64,
                      borderRadius: theme.radius.xl,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: on ? pom.fill : full ? 'transparent' : theme.colors.surface,
                      borderWidth: 1.5,
                      borderStyle: full ? 'dashed' : 'solid',
                      borderColor: on ? pom.fill : theme.colors.border,
                    }}
                  >
                    <Text variant="bodyStrong" face="display" tabular color={on ? pom.on : full ? 'textMuted' : 'text'}>
                      {slotWhen(s.at, now).time}
                    </Text>
                    <Text variant="caption" color={on ? pom.on : 'textMuted'} compact>
                      {full ? t('home_food.slot_full') : t('home_food.slot_left', { n: s.left })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {slot ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space[3] }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{t('home_food.qty')}</Text>
              {slot.left <= 3 ? (
                <Text variant="caption" color={pom.ink} weight={600}>
                  {t('home_food.qty_max', { n: slot.left })}
                </Text>
              ) : null}
            </View>
            <Stepper value={qty} min={1} max={maxQty} onChange={setQty} accessibilityLabel={t('home_food.qty')} />
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ModalSheet
      visible
      onClose={onClose}
      title={item.name}
      subtitle={item.description ?? undefined}
      leading={
        <View style={{ width: 64, height: 64, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
          <FoodArt {...artOf(item)} photoUrl={item.photoUrl} />
        </View>
      }
      aside={
        <Text variant="label" weight={700} tabular>
          {iqd(item.priceIqd, { locale })}
        </Text>
      }
      layout="sheet"
      sheetMaxWidth={MAX_CONTENT_WIDTH}
      closeLabel={t('action.close')}
      testID="reserve-sheet"
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Pressable
            testID="reserve-book"
            accessibilityRole="button"
            disabled={!slot || !when}
            accessibilityState={{ disabled: !slot }}
            onPress={() => {
              if (!slot) return;
              theme.haptic('success');
              onBook({ at: slot.at, qty });
            }}
            style={({ pressed }) => ({
              minHeight: 56,
              borderRadius: theme.radius.pill,
              backgroundColor: pom.fill,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: theme.space[5],
              opacity: !slot ? theme.state.disabledOpacity : pressed ? 0.9 : 1,
            })}
          >
            <Text variant="button" color={pom.on} tabular numberOfLines={1}>
              {when ? t('home_food.book', { day: when.day, time: when.time, amount: amountParam(total) }) : t('home_food.reserve')}
            </Text>
          </Pressable>
          {when ? (
            <Text variant="caption" color="textMuted" align="center" testID="reserve-note">
              {t('home_food.book_note', when)}
            </Text>
          ) : null}
        </View>
      }
    >
      <View style={{ gap: theme.space[5], paddingBottom: theme.space[2] }}>
        {portion ? <PortionPill label={portion} style={{ alignSelf: 'flex-start' }} /> : null}
        {body}
      </View>
    </ModalSheet>
  );
}
