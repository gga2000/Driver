import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { mentionsAllergy, type BoardOrder, type PrepKind } from '@driver/contracts';
import { Button, Chip, CountdownRing, Icon, ModalSheet, Stepper, Text, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { MIcon } from '@/components/MIcon';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useMenuActions } from '@/features/menu/queries';
import { clampPrep, committedPrep, defaultPrepChoice, dishesOut, kitchenNotes, partialValid, PREP_MAX, prepMin, prepOptions } from './logic';
import { KitchenNote, PaymentPill } from './OrderCard';
import { useOrderActions } from './queries';

export interface AcceptSheetProps {
  order: BoardOrder | null;
  /** The store, for taking a dish that ran out off the menu (m5). */
  storeId: string | null;
  onClose: () => void;
  /** The busy minutes in force (+10 or +20, r5); 0 when busy mode is off. */
  busyMinutes: number;
  /** t5: a juice bar or café picks 3 / 5 / 8; food 10 / 15 / 25. */
  prepKind: PrepKind;
  usualPrepMinutes: number;
  clock: () => number;
  /** Fired after a full accept (auto-print hooks in here). */
  onAccepted: (order: BoardOrder, minutes: number) => void;
  /** Open straight on "شنو اللي خلص؟" (from the reject sheet's "اقبل الباقي"). */
  startPartial?: boolean;
}

/**
 * Accept with a prep time (10 / 15 / 25 / custom; 3 / 5 / 8 for a juice bar or café). Busy mode adds
 * its +10 or +20 and says so. "صنف خلص؟" turns
 * the sheet into partial accept: tick what's out and the customer gets 60 s to approve the rest. The
 * dishes ticked as out come off the menu for the rest of the day too (m5, on unless the kitchen unticks
 * it), so the next customer can't order them; they come back by themselves tomorrow.
 */
export function AcceptSheet({ order, storeId, onClose, busyMinutes, prepKind, usualPrepMinutes, clock, onAccepted, startPartial = false }: AcceptSheetProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { accept } = useOrderActions();
  const { soldOutToday } = useMenuActions(storeId);
  const [choice, setChoice] = useState<number | 'custom'>(defaultPrepChoice(usualPrepMinutes, prepKind));
  const [custom, setCustom] = useState(prepKind === 'drinks' ? 10 : 30);
  const [partial, setPartial] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [stopToday, setStopToday] = useState(true);

  useEffect(() => {
    if (!order) return;
    setChoice(defaultPrepChoice(usualPrepMinutes, prepKind));
    setPartial(startPartial);
    setMissing(new Set());
    setStopToday(true);
    accept.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  if (!order) return null;
  const picked = choice === 'custom' ? clampPrep(custom, prepKind) : choice;
  const total = committedPrep(picked, busyMinutes);
  const lines = order.groups.flatMap((g) => g.lines.filter((l) => l.availability === 'available').map((l) => ({ ...l, who: g })));
  const lineIds = lines.map((l) => l.lineId);
  const canPartial = partialValid(missing, lineIds);
  // A practice order's dishes are pretend: nothing on the real menu changes.
  const outDishes = order.id.startsWith('practice-') ? [] : dishesOut(lines, missing);
  const names = outDishes.map((d) => d.name).join(t('merchant.stop_today.join'));

  /** m5: after the order went to the customer, the ticked dishes come off the menu for today. */
  const stopDishes = async () => {
    if (!storeId) return false;
    const done = await Promise.allSettled(outDishes.map((d) => soldOutToday.mutateAsync({ merchantOrgId: storeId, itemId: d.id })));
    return done.every((r) => r.status === 'fulfilled');
  };

  const submit = async () => {
    try {
      await accept.mutateAsync({ orderId: order.id, prepMinutes: picked, unavailableLineIds: partial ? [...missing] : [] });
      if (partial && stopToday && outDishes.length > 0) {
        const ok = await stopDishes();
        toast.show(ok ? { message: t('merchant.stop_today.done', { names }), tone: 'neutral', icon: 'clock' } : { message: t('merchant.stop_today.failed'), tone: 'danger' });
      } else if (partial) toast.show({ message: t('merchant.accept.sent_partial'), tone: 'neutral', icon: 'clock' });
      else {
        toast.show({ message: t('merchant.accept.done', { minutes: total }), tone: 'success' });
        onAccepted(order, total);
      }
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  const allergyNotes = kitchenNotes(order).filter((n) => mentionsAllergy(n));
  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="accept-sheet"
      title={t('merchant.accept.title', { number: order.number })}
      subtitle={t('merchant.card.items', { count: order.itemCount })}
      aside={order.acceptBy ? <CountdownRing mode="accept" startedAt={order.acceptBy.getTime() - 90_000} durationMs={90_000} clock={clock} size={60} strokeWidth={5} testID="accept-ring" /> : null}
      footer={
        partial ? (
          <Button
            testID="accept-partial-confirm"
            label={t('merchant.accept.confirm_partial', { count: missing.size })}
            size="lg"
            fullWidth
            disabled={!canPartial}
            loading={accept.isPending}
            onPress={() => void submit()}
          />
        ) : (
          <Button testID="accept-confirm" label={t('merchant.accept.confirm', { minutes: total })} size="lg" fullWidth haptic="success" loading={accept.isPending} onPress={() => void submit()} />
        )
      }
    >
      {/* Ideas b1/a7: the allergy is never covered. The sheet hid the ticket behind it, so every note
          that mentions an allergy is repeated here, first, before the prep time is chosen. */}
      {allergyNotes.length > 0 ? (
        <View testID="accept-allergy" style={{ gap: theme.space[2] }}>
          {allergyNotes.map((n, i) => (
            <KitchenNote key={i} note={n} />
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        <PaymentPill order={order} />
      </View>

      {!partial ? (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="title">{t('merchant.accept.prep_q')}</Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {prepOptions(prepKind).map((m) => {
              const selected = choice === m;
              return (
                <Pressable
                  key={m}
                  testID={`prep-${m}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    theme.haptic('selection');
                    setChoice(m);
                  }}
                  style={{
                    flex: 1,
                    height: 76,
                    borderRadius: theme.radius.lg,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? theme.colors.accent : theme.colors.border,
                    backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text weight={700} tabular style={{ fontSize: 28, lineHeight: 36 }} color={selected ? 'accentText' : 'text'}>
                    {String(m)}
                  </Text>
                  <Text variant="caption" color={selected ? 'accentText' : 'textMuted'}>
                    {t('merchant.accept.minutes_unit')}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              testID="prep-custom"
              accessibilityRole="radio"
              accessibilityState={{ selected: choice === 'custom' }}
              onPress={() => setChoice('custom')}
              style={{
                flex: 1,
                height: 76,
                borderRadius: theme.radius.lg,
                borderWidth: choice === 'custom' ? 2 : 1,
                borderColor: choice === 'custom' ? theme.colors.accent : theme.colors.border,
                backgroundColor: choice === 'custom' ? theme.colors.accentTint : theme.colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              <Icon name="plus" size={22} color={choice === 'custom' ? 'accentText' : 'text'} />
              <Text variant="caption" color={choice === 'custom' ? 'accentText' : 'textMuted'}>
                {t('merchant.accept.custom')}
              </Text>
            </Pressable>
          </View>
          {choice === 'custom' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <Text variant="label">{t('merchant.accept.custom_label')}</Text>
              <Stepper value={custom} onChange={(v) => setCustom(clampPrep(v, prepKind))} min={prepMin(prepKind)} max={PREP_MAX} accessibilityLabel={t('merchant.accept.custom_label')} />
            </View>
          ) : null}
          {busyMinutes > 0 ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center', backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
              <MIcon name="flame" size={20} color="warningText" />
              <Text variant="label" color="warningText" style={{ flex: 1 }}>
                {t('merchant.accept.busy_note_minutes', { extra: busyMinutes, total })}
              </Text>
            </View>
          ) : null}
          <Text variant="footnote" color="textMuted">
            {t('merchant.prep_time_honest')}
          </Text>
          <Button testID="accept-some-missing" label={t('merchant.accept.some_missing')} variant="ghost" icon="minus" onPress={() => setPartial(true)} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="title">{t('merchant.accept.missing_title')}</Text>
          <Text variant="footnote" color="textMuted">
            {t('merchant.accept.missing_hint')}
          </Text>
          <View style={{ gap: theme.space[2] }}>
            {lines.map((l) => {
              const on = missing.has(l.lineId);
              return (
                <Pressable
                  key={l.lineId}
                  testID={`missing-${l.lineId}`}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    theme.haptic('selection');
                    const next = new Set(missing);
                    if (on) next.delete(l.lineId);
                    else next.add(l.lineId);
                    setMissing(next);
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[3],
                    padding: theme.space[3],
                    borderRadius: theme.radius.lg,
                    borderWidth: on ? 2 : 1,
                    borderColor: on ? theme.colors.danger : theme.colors.border,
                    backgroundColor: on ? theme.colors.dangerTint : theme.colors.surface,
                  }}
                >
                  <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: on ? theme.colors.danger : theme.colors.borderStrong, backgroundColor: on ? theme.colors.danger : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <Icon name="x" size={16} color="onDanger" strokeWidth={2.5} /> : null}
                  </View>
                  <Text variant="bodyStrong" style={{ flex: 1 }}>{`${l.qty}× ${l.name}`}</Text>
                  {order.groups.length > 1 ? (
                    <Text variant="caption" color="textMuted">
                      {l.who.kind === 'orderer' ? t('merchant.card.orderer') : (l.who.label ?? '')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {outDishes.length > 0 && canPartial ? (
            <Pressable
              testID="accept-stop-today"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: stopToday }}
              onPress={() => {
                theme.haptic('selection');
                setStopToday(!stopToday);
              }}
              style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], minHeight: 44, paddingVertical: theme.space[2] }}
            >
              <View style={{ marginTop: 2, width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: stopToday ? theme.colors.text : theme.colors.borderStrong, backgroundColor: stopToday ? theme.colors.text : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {stopToday ? <MIcon name="check" size={16} color="surface" strokeWidth={3} /> : null}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{outDishes.length === 1 ? t('merchant.stop_today.one', { dish: outDishes[0]!.name }) : t('merchant.stop_today.many')}</Text>
                <Text variant="footnote" color="textMuted">
                  {outDishes.length === 1 ? t('merchant.stop_today.hint_one') : t('merchant.stop_today.hint_many', { names })}
                </Text>
              </View>
            </Pressable>
          ) : null}
          {missing.size > 0 && missing.size >= lineIds.length ? (
            <Text variant="footnote" color="dangerText">
              {t('merchant.accept.all_missing')}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Chip label={t('merchant.common.cancel')} icon="chevron-back" role="button" onPress={() => setPartial(false)} />
          </View>
        </View>
      )}
    </ModalSheet>
  );
}
