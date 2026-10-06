import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Button, Chip, CountdownRing, Icon, ModalSheet, Stepper, Text, useTheme, useToast } from '@driver/ui';
import { MIcon } from '@/components/MIcon';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { clampPrep, committedPrep, defaultPrepChoice, partialValid, PREP_MAX, PREP_MIN, PREP_OPTIONS } from './logic';
import { PaymentPill } from './OrderCard';
import { useOrderActions } from './queries';

export interface AcceptSheetProps {
  order: BoardOrder | null;
  onClose: () => void;
  busyOn: boolean;
  usualPrepMinutes: number;
  clock: () => number;
  /** Fired after a full accept (auto-print hooks in here). */
  onAccepted: (order: BoardOrder, minutes: number) => void;
  /** Open straight on "شنو اللي خلص؟" (from the reject sheet's "اقبل الباقي"). */
  startPartial?: boolean;
}

/**
 * Accept with a prep time (10 / 15 / 25 / custom). Busy mode adds 10 and says so. "صنف خلص؟" turns
 * the sheet into partial accept: tick what's out and the customer gets 60 s to approve the rest.
 */
export function AcceptSheet({ order, onClose, busyOn, usualPrepMinutes, clock, onAccepted, startPartial = false }: AcceptSheetProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { accept } = useOrderActions();
  const [choice, setChoice] = useState<number | 'custom'>(defaultPrepChoice(usualPrepMinutes));
  const [custom, setCustom] = useState(30);
  const [partial, setPartial] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!order) return;
    setChoice(defaultPrepChoice(usualPrepMinutes));
    setPartial(startPartial);
    setMissing(new Set());
    accept.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  if (!order) return null;
  const picked = choice === 'custom' ? clampPrep(custom) : choice;
  const total = committedPrep(picked, busyOn);
  const lines = order.groups.flatMap((g) => g.lines.filter((l) => l.availability === 'available').map((l) => ({ ...l, who: g })));
  const lineIds = lines.map((l) => l.lineId);
  const canPartial = partialValid(missing, lineIds);

  const submit = async () => {
    try {
      await accept.mutateAsync({ orderId: order.id, prepMinutes: picked, unavailableLineIds: partial ? [...missing] : [] });
      if (partial) toast.show({ message: t('merchant.accept.sent_partial'), tone: 'neutral', icon: 'clock' });
      else {
        toast.show({ message: t('merchant.accept.done', { minutes: total }), tone: 'success' });
        onAccepted(order, total);
      }
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

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
      <View style={{ flexDirection: 'row' }}>
        <PaymentPill order={order} />
      </View>

      {!partial ? (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="title">{t('merchant.accept.prep_q')}</Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {PREP_OPTIONS.map((m) => {
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
              <Stepper value={custom} onChange={(v) => setCustom(clampPrep(v))} min={PREP_MIN} max={PREP_MAX} accessibilityLabel={t('merchant.accept.custom_label')} />
            </View>
          ) : null}
          {busyOn ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center', backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
              <MIcon name="flame" size={20} color="warningText" />
              <Text variant="label" color="warningText" style={{ flex: 1 }}>
                {t('merchant.accept.busy_note', { total })}
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
