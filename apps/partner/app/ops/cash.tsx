import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { OpsCashHolder } from '@driver/contracts';
import { Avatar, Button, Card, Chip, EmptyState, Icon, Skeleton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { SectionHeader, TierPill } from '@/features/fleet/FleetParts';
import { cashTone, maskedPhone } from '@/features/fleet/logic';
import { amountInput, amountProblem, canConfirmCash, parseAmount, pressKey, quickAmounts, receiptKey, type PadKey } from '@/features/ops/logic';
import { CodeBoxes, CodePad } from '@/features/ops/OpsParts';
import { useCashHolders, useRecordCashReceipt } from '@/features/ops/queries';
import { capShare } from '@/features/work/logic';
import { apiErrorCode, apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';

/**
 * استلام كاش — a courier hands cash to field ops (money §4 channel 1). Pick the courier, enter the
 * amount (at most what he holds), key in the 4-digit hand-over code he reads from his app, confirm.
 * `ops.recordCashReceipt` posts the settlement and sends him the WhatsApp receipt; the receipt
 * screen shows the same summary.
 */
export default function OpsCash() {
  const theme = useTheme();
  const t = useT();
  const { courierId: preset } = useLocalSearchParams<{ courierId?: string }>();
  const holders = useCashHolders();
  const [picked, setPicked] = useState<string | null>(preset || null);
  const courier = holders.data?.find((h) => h.courierId === picked) ?? null;

  if (courier) return <HandOver key={courier.courierId} courier={courier} onChange={() => setPicked(null)} />;

  return (
    <Screen edges={['bottom']} testID="ops-cash">
      <Stack.Screen options={{ title: t('partner.ops_cash_title') }} />
      {!holders.data ? (
        <Skeleton lines={4} />
      ) : holders.data.length === 0 ? (
        <EmptyState icon="wallet" title={t('partner.ops_cash_none')} style={{ paddingTop: theme.space[10] }} />
      ) : (
        <View style={{ gap: theme.space[2] }}>
          <SectionHeader title={t('partner.ops_cash_pick')} />
          <View style={{ gap: theme.space[3] }}>
            {holders.data.map((h) => (
              <CourierCard key={h.courierId} h={h} onPress={() => setPicked(h.courierId)} />
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

function CourierCard({ h, onPress }: { h: OpsCashHolder; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const tone = cashTone(h.owedIqd, h.capIqd, h.overCap);
  const share = capShare(h.owedIqd, h.capIqd);
  return (
    <Card elevation={1} padding={4} onPress={onPress} testID={`ops-courier-${h.courierId}`} accessibilityLabel={h.name ?? undefined}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={h.name ?? undefined} {...(h.name ? {} : { icon: 'user' as const })} size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
                {h.name ?? maskedPhone(h.phoneMasked)}
              </Text>
              {h.overCap ? <StatusPill size="sm" tone="danger" label={t('partner.ops_task_over_cap')} /> : null}
            </View>
            <Text variant="caption" color="textMuted" tabular>
              {maskedPhone(h.phoneMasked)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="title" weight={700} tabular>
              {amountParam(h.heldIqd)}
            </Text>
            {/* The cash he carries (what can be handed over); «عليه» under the bar is what counts against his cap. */}
            <Text variant="caption" color="textMuted">
              {t('partner.ops_cash_held_unit')}
            </Text>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: theme.colors.surfaceSunken, overflow: 'hidden' }}>
            {share > 0 ? <View style={{ height: 6, borderRadius: 3, width: `${Math.max(share * 100, 3)}%`, backgroundColor: theme.colors[tone] }} /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="caption" color={tone === 'danger' ? 'dangerText' : tone === 'warning' ? 'warningText' : 'textMuted'} tabular>
              {t('partner.ops_cash_owed_cap', { owed: amountParam(h.owedIqd), cap: amountParam(h.capIqd) })}
            </Text>
            <TierPill tier={h.tier} />
          </View>
        </View>
      </View>
    </Card>
  );
}

function HandOver({ courier, onChange }: { courier: OpsCashHolder; onChange: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const record = useRecordCashReceipt();
  const [raw, setRaw] = useState(amountInput(String(courier.heldIqd)));
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const nonce = useRef(Math.random().toString(36).slice(2, 10));
  const amount = parseAmount(raw);
  const problem = amountProblem(amount, courier.heldIqd);
  const chips = useMemo(() => quickAmounts(courier.heldIqd), [courier.heldIqd]);
  const ready = canConfirmCash(amount, courier.heldIqd, code);

  const onKey = (k: PadKey) => {
    setCodeError(null);
    setCode((c) => pressKey(c, k));
  };

  const confirm = async () => {
    if (!ready) return;
    try {
      const r = await record.mutateAsync({ courierId: courier.courierId, amountIqd: amount, code, idempotencyKey: receiptKey(courier.courierId, amount, nonce.current) });
      router.replace({
        pathname: '/ops/receipt',
        params: {
          amount: String(r.amountIqd),
          ref: r.reference,
          at: r.receivedAt.toISOString(),
          owed: String(r.courierOwedIqd),
          capLeft: String(r.courierCapRemainingIqd),
          name: courier.name ?? '',
          phone: courier.phoneMasked ?? '',
        },
      });
    } catch (err) {
      const codeName = apiErrorCode(err);
      if (codeName === 'handover_code_invalid') {
        setCode('');
        setCodeError(t('partner.ops_cash_code_wrong'));
        nonce.current = Math.random().toString(36).slice(2, 10);
        return;
      }
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  return (
    <Screen
      edges={['bottom']}
      testID="ops-cash-handover"
      contentStyle={{ gap: theme.space[4] }}
      footer={
        <View style={{ gap: theme.space[2] }}>
          <Button
            testID="ops-cash-confirm"
            label={amount > 0 ? t('partner.ops_cash_confirm', { amount: amountParam(amount) }) : t('partner.ops_cash_amount')}
            fullWidth
            size="lg"
            disabled={!ready}
            loading={record.isPending}
            onPress={() => void confirm()}
          />
          <Text variant="caption" color="textMuted" align="center">
            {t('partner.ops_cash_count')}
          </Text>
        </View>
      }
    >
      <Stack.Screen options={{ title: t('partner.ops_cash_title') }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[3] }}>
        <Avatar name={courier.name ?? undefined} {...(courier.name ? {} : { icon: 'user' as const })} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={600} numberOfLines={1}>
            {courier.name ?? maskedPhone(courier.phoneMasked)}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.ops_cash_holds', { amount: amountParam(courier.heldIqd) })}
          </Text>
        </View>
        <Pressable testID="ops-cash-change" accessibilityRole="button" onPress={onChange} hitSlop={8}>
          <Text variant="label" weight={600} color="accentText">
            {t('partner.ops_cash_change')}
          </Text>
        </Pressable>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="label" color="textMuted">
          {t('partner.ops_cash_amount')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], borderBottomWidth: 2, borderBottomColor: problem === 'over' ? theme.colors.danger : theme.colors.accent, paddingBottom: 4 }}>
          <TextInput
            testID="ops-cash-amount"
            value={raw}
            onChangeText={(v) => setRaw(amountInput(v))}
            keyboardType="number-pad"
            inputMode="numeric"
            accessibilityLabel={t('partner.ops_cash_amount')}
            style={{ flex: 1, fontSize: theme.type.numeralSm.size, color: theme.colors.text, ...theme.font(700), fontVariant: ['tabular-nums'], textAlign: 'right', padding: 0, outlineStyle: 'none' } as never}
          />
          <Text variant="title" color="textMuted">
            {t('quote.currency')}
          </Text>
        </View>
        {problem === 'over' ? (
          <Text variant="footnote" color="dangerText" tabular>
            {`${t('partner.ops_cash_over')} · ${t('partner.ops_cash_max', { amount: amountParam(courier.heldIqd) })}`}
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
          {chips.map((c, i) => (
            <Chip key={c} testID={`ops-cash-chip-${c}`} role="radio" selected={amount === c} label={i === 0 ? t('partner.ops_cash_all') : amountParam(c)} onPress={() => setRaw(amountInput(String(c)))} />
          ))}
        </View>
      </View>

      <View style={{ gap: theme.space[2] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="shield" size={18} color="textMuted" />
          <Text variant="label" weight={600}>
            {t('partner.ops_cash_code')}
          </Text>
        </View>
        <Text variant="footnote" color={codeError ? 'dangerText' : 'textMuted'}>
          {codeError ?? t('partner.ops_cash_code_hint')}
        </Text>
        <CodeBoxes code={code} error={!!codeError} />
      </View>

      <CodePad onKey={onKey} disabled={record.isPending} />
    </Screen>
  );
}
