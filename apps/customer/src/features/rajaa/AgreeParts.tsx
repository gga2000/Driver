import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import type { AgreementKind, AgreementView } from '@driver/contracts';
import { Button, Icon, Rule, StatusPill, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd } from '@/lib/money';
import type { AgreementPhase } from './agree';
import { clockLabel } from './logic';
import { OptionCard } from './Option';
import { useRespondAgreement, useWithdrawAgreement } from './queries';

const KIND_ICON: Record<AgreementKind, IconName> = { pin_pickup: 'map-pin', door_drop: 'home' };

/**
 * Step 4: one agreed-price choice on the booking screen, in whichever phase it is: «اسأل السايق»,
 * waiting for his price, his price to accept or turn down, or agreed (a choice like any other).
 */
export function AgreementSlot({
  kind,
  phase,
  title,
  askTitle,
  askHint,
  selected,
  onSelect,
  onAsk,
  testID,
}: {
  kind: AgreementKind;
  phase: AgreementPhase;
  /** «نقطتك على الطريق» / «باب بيتك ببغداد». */
  title: string;
  askTitle: string;
  askHint: string;
  selected: boolean;
  onSelect: (a: AgreementView) => void;
  onAsk: () => void;
  testID?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const id = testID ?? `agree-${kind}`;

  if (phase.phase === 'ask') {
    const again = phase.last === 'expired' ? t('rajaa.agree_expired') : phase.last === 'declined' ? t('rajaa.agree_declined') : null;
    return <AskRow icon={KIND_ICON[kind]} title={again ? t('rajaa.agree_ask_again') : askTitle} hint={again ?? askHint} onPress={onAsk} testID={`${id}-ask`} />;
  }
  if (phase.phase === 'waiting') return <WaitingCard icon={KIND_ICON[kind]} title={title} agreement={phase.agreement} testID={`${id}-waiting`} />;
  if (phase.phase === 'priced')
    return <PricedCard icon={KIND_ICON[kind]} title={title} agreement={phase.agreement} testID={`${id}-priced`} />;
  const a = phase.agreement;
  const amount = a.amountIqd ?? 0;
  return (
    <OptionCard
      testID={`${id}-agreed`}
      icon={KIND_ICON[kind]}
      title={title}
      detail={a.note ?? (amount === 0 ? t('rajaa.agree_done_free') : t('rajaa.agree_done', { amount: amountParam(amount) }))}
      trailing={amount === 0 ? t('rajaa.pickup_free') : iqd(amount, { locale, sign: true })}
      selected={selected}
      onPress={() => onSelect(a)}
    />
  );
}

export function AskRow({ icon, title, hint, onPress, testID }: { icon: IconName; title: string; hint: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${hint}`}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 56,
        padding: theme.space[4],
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: theme.colors.borderStrong,
        backgroundColor: pressed ? theme.colors.surfaceSunken : 'transparent',
      })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={18} color="accentText" strokeWidth={2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label" weight={600}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted">
          {hint}
        </Text>
      </View>
      <Icon name="plus" size={18} color="accentText" strokeWidth={2.25} />
    </Pressable>
  );
}

function SlotFrame({ icon, title, note, accent, children, testID }: { icon: IconName; title: string; note: string | null; accent: boolean; children: ReactNode; testID: string }) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={{
        borderRadius: theme.radius.lg,
        borderWidth: accent ? 1.5 : 1,
        borderColor: accent ? theme.colors.accent : theme.colors.border,
        backgroundColor: theme.colors.surface,
        padding: theme.space[4],
        gap: theme.space[3],
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: accent ? theme.colors.accentTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={accent ? 'accentText' : 'textMuted'} strokeWidth={2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label" weight={600}>
            {title}
          </Text>
          {note ? (
            <Text variant="caption" color="textMuted" numberOfLines={2}>
              {note}
            </Text>
          ) : null}
        </View>
      </View>
      {children}
    </View>
  );
}

function WaitingCard({ icon, title, agreement, testID }: { icon: IconName; title: string; agreement: AgreementView; testID: string }) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const withdraw = useWithdrawAgreement();
  return (
    <SlotFrame icon={icon} title={title} note={agreement.note} accent={false} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <StatusPill label={t('rajaa.agree_waiting')} tone="info" icon="clock" live />
        <Button
          testID={`${testID}-cancel`}
          label={t('rajaa.agree_cancel')}
          variant="ghost"
          size="sm"
          loading={withdraw.isPending}
          onPress={() =>
            withdraw.mutate(
              { agreementId: agreement.id },
              { onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000) },
            )
          }
        />
      </View>
    </SlotFrame>
  );
}

function PricedCard({
  icon,
  title,
  agreement,
  testID,
}: {
  icon: IconName;
  title: string;
  agreement: AgreementView;
  testID: string;
}) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const respond = useRespondAgreement();
  const amount = agreement.amountIqd ?? 0;
  const answer = (accept: boolean) =>
    respond.mutate(
      { agreementId: agreement.id, accept },
      {
        // The screen picks an agreed price itself when the list shows it (this card is gone by then).
        onSuccess: () => theme.haptic(accept ? 'success' : 'selection'),
        onError: (err) => toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 5000),
      },
    );
  return (
    <SlotFrame icon={icon} title={title} note={agreement.note} accent testID={testID}>
      <View style={{ gap: 2 }}>
        <Text variant="heading" tabular accessibilityLiveRegion="polite">
          {amount === 0 ? t('rajaa.agree_offer_free') : t('rajaa.agree_offer', { amount: amountParam(amount) })}
        </Text>
        {agreement.expiresAt ? (
          <Text variant="caption" color="textMuted">
            {t('rajaa.agree_offer_until', { time: clockLabel(new Date(agreement.expiresAt)) })}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        <View style={{ flex: 1 }}>
          <Button testID={`${testID}-accept`} label={t('rajaa.agree_accept')} icon="check" fullWidth loading={respond.isPending && respond.variables?.accept === true} disabled={respond.isPending} onPress={() => answer(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button testID={`${testID}-decline`} label={t('rajaa.agree_decline')} variant="secondary" fullWidth loading={respond.isPending && respond.variables?.accept === false} disabled={respond.isPending} onPress={() => answer(false)} />
        </View>
      </View>
    </SlotFrame>
  );
}

/** «اللي اتفقنا عليه»: under a booking's lines when a price on it was agreed with the driver. */
export function AgreedNote() {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="rajaa-agreed-note" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.accentTint }}>
      <Icon name="lock" size={16} color="accentText" strokeWidth={2} />
      <Text variant="caption" color="accentText" style={{ flex: 1 }}>
        <Text variant="caption" color="accentText" weight={600}>
          {t('rajaa.agreed_strip_title')}
        </Text>
        {` · ${t('rajaa.agreed_strip_hint')}`}
      </Text>
    </View>
  );
}

/** A price line for something agreed for free («ببلاش»): a receipt row that says so, not «0». */
export function FreeLine({ label, testID }: { label: string; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2], paddingVertical: theme.space[1] }}>
      <Text variant="body" style={{ flexShrink: 1 }}>
        {label}
      </Text>
      <Rule kind="dotted" color="borderStrong" thickness={1.5} style={{ flex: 1, minWidth: theme.space[3], alignSelf: 'center', marginTop: 8 }} />
      <Text variant="body" color="successText" weight={600}>
        {t('rajaa.agree_free')}
      </Text>
    </View>
  );
}
