import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { BoardOrder } from '@driver/contracts';
import { Button, ModalSheet, Text, TextField, useTheme } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { MIcon, type MIconName } from '@/components/MIcon';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { REJECT_LABEL, REJECT_REASONS, rejectReasonValue, type RejectReason } from './logic';
import { useOrderActions } from './queries';

const ICON: Record<RejectReason, MIconName> = { sold_out: 'utensils', too_busy: 'flame', closed: 'power', other: 'chat' };
/** A better move than rejecting, offered under the reason it fits. */
const NUDGE: Partial<Record<RejectReason, { text: TKey; action: 'partial' | 'busy' | 'close' }>> = {
  sold_out: { text: 'merchant.reject.partial_hint', action: 'partial' },
  too_busy: { text: 'merchant.reject.busy_hint', action: 'busy' },
  closed: { text: 'merchant.reject.closed_hint', action: 'close' },
};

export interface RejectSheetProps {
  order: BoardOrder | null;
  onClose: () => void;
  /** "اقبل الباقي" → open the accept sheet in partial mode; busy/close open the store sheets. */
  onAlternative: (action: 'partial' | 'busy' | 'close', order: BoardOrder) => void;
}

/** Reject with a reason (خلص الأكل، زحمة، مسدودين، غيره) — and the better move for each one. */
export function RejectSheet({ order, onClose, onAlternative }: RejectSheetProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { reject } = useOrderActions();
  const [reason, setReason] = useState<RejectReason | null>(null);
  const [other, setOther] = useState('');

  useEffect(() => {
    setReason(null);
    setOther('');
    reject.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  if (!order) return null;
  const value = reason ? rejectReasonValue(reason, other) : null;
  const nudge = reason ? NUDGE[reason] : undefined;
  const late = order.column !== 'new';

  const submit = async () => {
    if (!value) return;
    try {
      await reject.mutateAsync({ orderId: order.id, reason: value });
      toast.show({ message: t('merchant.reject.done'), tone: 'neutral' });
      onClose();
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  return (
    <ModalSheet
      visible
      onClose={onClose}
      testID="reject-sheet"
      title={t('merchant.reject.title', { number: order.number })}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Text variant="caption" color="textMuted" align="center">
            {late ? t('merchant.reject_after_accept_warn') : t('merchant.reject.score_note')}
          </Text>
          <Button testID="reject-confirm" label={t('merchant.reject.confirm')} variant="destructive" size="lg" fullWidth disabled={!value} loading={reject.isPending} onPress={() => void submit()} />
        </View>
      }
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {REJECT_REASONS.map((r) => {
          const selected = reason === r;
          return (
            <Pressable
              key={r}
              testID={`reason-${r}`}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                theme.haptic('selection');
                setReason(r);
              }}
              style={{
                flexBasis: '47%',
                flexGrow: 1,
                minHeight: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.space[3],
                paddingHorizontal: theme.space[4],
                borderRadius: theme.radius.lg,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.colors.danger : theme.colors.border,
                backgroundColor: selected ? theme.colors.dangerTint : theme.colors.surface,
              }}
            >
              <MIcon name={ICON[r]} size={22} color={selected ? 'dangerText' : 'textMuted'} />
              <Text variant="bodyStrong" color={selected ? 'dangerText' : 'text'}>
                {t(REJECT_LABEL[r])}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {reason === 'other' ? (
        <TextField testID="reject-other" value={other} onChangeText={setOther} placeholder={t('merchant.reject.other_placeholder')} maxLength={180} autoFocus />
      ) : null}
      {nudge && !late ? (
        <Pressable
          testID={`reject-nudge-${nudge.action}`}
          onPress={() => onAlternative(nudge.action, order)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.accentTint, borderRadius: theme.radius.lg, padding: theme.space[4] }}
        >
          <MIcon name={nudge.action === 'partial' ? 'check' : nudge.action === 'busy' ? 'flame' : 'power'} size={22} color="accentText" />
          <Text variant="label" weight={600} color="accentText" style={{ flex: 1 }}>
            {t(nudge.text)}
          </Text>
          <MIcon name="chevron-forward" size={20} color="accentText" />
        </Pressable>
      ) : null}
    </ModalSheet>
  );
}
