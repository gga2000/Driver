import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { TOPUP_RULES, type TopUpView } from '@driver/contracts';
import { Button, Card, ChipGroup, Icon, ListRow, Skeleton, StatusPill, Text, TextField, useTheme } from '@driver/ui';
import { QrCode } from '@/components/QrCode';
import { Screen } from '@/components/Screen';
import { useRequestTopUp, useTopUpStatus } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';

const PRESETS = [10_000, 25_000, 50_000, 100_000];

/** "482913" → "482 913", kept left-to-right inside Arabic text. */
function spacedCode(code: string): string {
  return `⁦${code.slice(0, 3)} ${code.slice(3)}⁩`;
}

/** "12:30 · 5/10" (12-hour clock, voice guide §5) for the code's expiry, device local time. */
function untilLabel(d: Date): string {
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12;
  return `⁦${h}:${String(d.getMinutes()).padStart(2, '0')} · ${d.getDate()}/${d.getMonth() + 1}⁩`;
}

/**
 * شحن المحفظة (domain §12, money §4): pick an amount → a 6-digit code and its QR → hand it with the
 * cash to a Driver ops agent or the courier on the next order. The screen polls the request and
 * turns into the receipt the moment the cash is confirmed (the ledger credits the wallet), or offers
 * a new code once this one expires (24 h). No payment gateway yet: ZainCash lands behind the same flow.
 */
export default function TopUpScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [topUpId, setTopUpId] = useState<string | undefined>(undefined);
  const status = useTopUpStatus(topUpId);
  const request = useRequestTopUp();
  const [mode, setMode] = useState<'pick' | 'code' | null>(null);
  const [preset, setPreset] = useState<string>(String(PRESETS[1]));
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const current = status.data ?? null;
  // First load: a code still waiting (or one that just landed) opens on the code; otherwise the amount picker.
  useEffect(() => {
    if (mode !== null || status.isPending) return;
    setMode(current && (current.state === 'pending' || (topUpId && current.state === 'confirmed')) ? 'code' : 'pick');
  }, [mode, status.isPending, current, topUpId]);

  const amount = preset === 'other' ? Number(custom.replace(/[^\d]/g, '')) : Number(preset);
  const amountOk = amount >= TOPUP_RULES.minIqd && amount <= TOPUP_RULES.maxIqd && amount % TOPUP_RULES.stepIqd === 0;
  const left = current?.dailyRemainingIqd ?? TOPUP_RULES.dailyMaxIqd;

  const getCode = async () => {
    if (!amountOk) return;
    setError(null);
    try {
      const res = await request.mutateAsync({ amountIqd: amount });
      setTopUpId(res.topUpId);
      setMode('code');
    } catch (err) {
      setError(apiErrorMessage(err, t('error.network'), locale));
    }
  };

  if (mode === null) {
    return (
      <Screen edges={['bottom']} testID="topup">
        <Skeleton height={220} />
      </Screen>
    );
  }

  if (mode === 'code' && current) return <CodeView v={current} onChange={() => setMode('pick')} onNew={() => setMode('pick')} />;

  return (
    <Screen
      edges={['bottom']}
      testID="topup-pick"
      footer={
        <View style={{ gap: theme.space[2] }}>
          {error ? (
            <Text variant="footnote" color="dangerText" testID="topup-error">
              {error}
            </Text>
          ) : null}
          <Button
            testID="topup-get-code"
            size="lg"
            fullWidth
            icon="wallet"
            disabled={!amountOk}
            loading={request.isPending}
            label={amountOk ? t('topup.get_code', { amount: amountParam(amount) }) : t('topup.title')}
            onPress={() => void getCode()}
          />
        </View>
      }
    >
      <View style={{ gap: theme.space[2] }}>
        <Text variant="heading" accessibilityRole="header">
          {t('topup.amount_title')}
        </Text>
        <Text variant="body" color="textMuted">
          {t('topup.amount_body')}
        </Text>
      </View>
      <ChipGroup
        items={[...PRESETS.map((p) => ({ id: String(p), label: iqd(p, { locale }) })), { id: 'other', label: t('topup.other_amount') }]}
        value={[preset]}
        required
        onChange={(v) => setPreset(v[0] ?? String(PRESETS[1]))}
        accessibilityLabel={t('topup.amount_title')}
      />
      {preset === 'other' ? (
        <TextField testID="topup-custom" value={custom} onChangeText={setCustom} placeholder={t('topup.amount_placeholder')} keyboardType="number-pad" leadingIcon="wallet" />
      ) : null}
      <Text variant="footnote" color="textMuted" tabular>
        {t('topup.limits', { min: amountParam(TOPUP_RULES.minIqd), max: amountParam(TOPUP_RULES.maxIqd), left: amountParam(left) })}
      </Text>
      <WherePay />
    </Screen>
  );
}

function CodeView({ v, onChange, onNew }: { v: TopUpView; onChange: () => void; onNew: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();

  if (v.state === 'confirmed') {
    return (
      <Screen
        edges={['bottom']}
        testID="topup-done"
        footer={<Button testID="topup-back" size="lg" fullWidth label={t('topup.back_wallet')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/wallet'))} />}
      >
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[6] }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={38} color="successText" strokeWidth={2.6} />
          </View>
          <Text variant="heading" align="center">
            {t('topup.done_title')}
          </Text>
          <Text variant="amount" tabular>
            {iqd(v.amountIqd, { locale, sign: true })}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('topup.done_body', { amount: amountParam(v.amountIqd), ref: `⁦${v.reference ?? ''}⁩` })}
          </Text>
        </View>
      </Screen>
    );
  }

  if (v.state !== 'pending') {
    return (
      <Screen edges={['bottom']} testID="topup-expired" footer={<Button testID="topup-new" size="lg" fullWidth icon="plus" label={t('topup.new_code')} onPress={onNew} />}>
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[6] }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="clock" size={34} color="textMuted" />
          </View>
          <Text variant="heading" align="center">
            {t('topup.expired_title')}
          </Text>
          <Text variant="body" color="textMuted" align="center">
            {t('topup.expired_body')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['bottom']} testID="topup-code" footer={<Button testID="topup-change" size="md" variant="secondary" fullWidth label={t('topup.change_amount')} onPress={onChange} />}>
      <Card elevation={2} padding={0} style={{ overflow: 'hidden' }}>
        <View style={{ backgroundColor: theme.colors.text, paddingVertical: theme.space[4], paddingHorizontal: theme.space[5], gap: 2 }}>
          <Text variant="label" color={theme.colors.accentTint}>
            {t('topup.code_title')}
          </Text>
          <Text variant="display" color={theme.colors.bg} tabular testID="topup-amount">
            {iqd(v.amountIqd, { locale })}
          </Text>
        </View>
        <View style={{ alignItems: 'center', gap: theme.space[3], padding: theme.space[5] }}>
          <Text testID="topup-code-digits" variant="display" tabular style={{ fontSize: 44, lineHeight: 56, letterSpacing: 6 }} accessibilityLabel={v.code.split('').join(' ')}>
            {spacedCode(v.code)}
          </Text>
          <View style={{ padding: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: theme.colors.border }}>
            <QrCode value={v.qrPayload} size={172} testID="topup-qr" />
          </View>
          <Text variant="footnote" color="textMuted">
            {t('topup.scan_hint')}
          </Text>
          <StatusPill live tone="accent" label={t('topup.waiting')} />
          <Text variant="footnote" color="textMuted" tabular>
            {t('topup.expires', { time: untilLabel(v.expiresAt) })}
          </Text>
        </View>
      </Card>
      <Text variant="body" align="center">
        {t('topup.code_body', { amount: amountParam(v.amountIqd) })}
      </Text>
      <WherePay />
      <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'flex-start' }}>
        <Icon name="shield" size={18} color="textMuted" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('topup.single_use')}
        </Text>
      </View>
    </Screen>
  );
}

function WherePay() {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="title" accessibilityRole="header">
        {t('topup.where_title')}
      </Text>
      <Card elevation={0} padding={0}>
        <ListRow leading="user" title={t('topup.where_agent')} chevron={false} divider />
        <ListRow leading="bike" title={t('topup.where_courier')} chevron={false} />
      </Card>
    </View>
  );
}
