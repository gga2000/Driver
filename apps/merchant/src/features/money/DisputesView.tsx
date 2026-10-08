import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import type { MerchantDispute } from '@driver/contracts';
import { Button, EmptyState, ModalSheet, Skeleton, Text, TextField, useTheme, useToast, type StatusTone } from '@driver/ui';
import { MIcon, type MIconName } from '@/components/MIcon';
import { Panel, Tag } from '@/components/Panel';
import { apiErrorMessage } from '@/lib/api';
import { useDates } from '@/lib/dates';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { canSendAnswer, disputeClock, lateMinutes, ticketNumber, type DisputeClock } from './logic';
import { absoluteUploadUrl, pickPhoto, uploadPhoto, type PickedPhoto } from './photo';
import { usePhotoTicket, useRespondDispute } from './queries';

const KIND_ICON: Record<MerchantDispute['kind'], MIconName> = {
  cold_or_late: 'clock',
  missing_item: 'bag',
  wrong_item: 'swap',
  not_delivered: 'map-pin',
  ride_fare: 'car',
  driver_behaviour: 'chat',
  unsafe_driving: 'car',
  other: 'chat',
};

const STATUS: Record<DisputeClock['status'], { key: TKey; tone: StatusTone }> = {
  waiting: { key: 'merchant.disputes.waiting', tone: 'warning' },
  contested: { key: 'merchant.disputes.contested', tone: 'info' },
  accepted: { key: 'merchant.disputes.accepted', tone: 'neutral' },
  default_applied: { key: 'merchant.disputes.default_applied', tone: 'neutral' },
};

/** الفلوس → الشكاوى: last 30 days, each with its default outcome and the clock to answer. */
export function DisputesView({ merchantOrgId, disputes, now, wide }: { merchantOrgId: string; disputes: MerchantDispute[] | undefined; now: number; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  if (!disputes) return <Skeleton height={220} radius={20} />;
  if (disputes.length === 0) {
    return (
      <Panel>
        <EmptyState icon="check" title={t('merchant.disputes.empty_title')} body={t('merchant.disputes.empty_body')} />
      </Panel>
    );
  }
  const current = disputes.find((d) => d.orderId === open) ?? null;
  return (
    <>
      <View style={{ flexDirection: wide ? 'row' : 'column', flexWrap: 'wrap', gap: theme.space[4] }}>
        {disputes.map((d) => (
          <View key={d.orderId} style={wide ? { flexBasis: '48%', flexGrow: 1 } : undefined}>
            <DisputeCard dispute={d} now={now} onOpen={() => setOpen(d.orderId)} />
          </View>
        ))}
      </View>
      {current ? <DisputeSheet merchantOrgId={merchantOrgId} dispute={current} now={now} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function DisputeCard({ dispute: d, now, onOpen }: { dispute: MerchantDispute; now: number; onOpen: () => void }) {
  const theme = useTheme();
  const t = useT();
  const dates = useDates();
  const clock = disputeClock(d, now);
  const status = STATUS[clock.status];
  const waiting = clock.status === 'waiting';
  return (
    <Pressable
      testID={`dispute-${d.orderId}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => ({
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.xl,
        borderWidth: waiting ? 2 : 1,
        borderColor: waiting ? (clock.urgent ? theme.colors.danger : theme.colors.warning) : theme.colors.border,
        padding: theme.space[5],
        gap: theme.space[3],
        opacity: pressed ? 0.92 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: waiting ? theme.colors.warningTint : theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <MIcon name={KIND_ICON[d.kind]} size={22} color={waiting ? 'warningText' : 'textMuted'} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={1}>
            {t(`merchant.disputes.kind_${d.kind}` as TKey)}
          </Text>
          <Text variant="caption" color="textMuted" tabular>
            {`${t('merchant.disputes.order', { ref: ticketNumber(d.orderId) })} · ${t('merchant.disputes.opened', { when: dates.when(d.openedAt, now) })}`}
          </Text>
        </View>
        <Tag label={t(status.key)} tone={status.tone} />
      </View>
      {d.note ? (
        <View style={{ borderStartWidth: 3, borderStartColor: theme.colors.borderStrong, paddingStart: theme.space[3] }}>
          <Text variant="body" numberOfLines={2}>
            {`"${d.note}"`}
          </Text>
        </View>
      ) : null}
      <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3], gap: 2 }}>
        <Text variant="caption" weight={600} color="textMuted">
          {t('merchant.disputes.default_title')}
        </Text>
        <Text variant="footnote">{d.defaultOutcome.text_ar}</Text>
        <Text variant="caption" weight={600} color={d.defaultOutcome.merchantImpactIqd > 0 ? 'dangerText' : 'successText'} tabular>
          {d.defaultOutcome.merchantImpactIqd > 0 ? t('merchant.disputes.impact', { amount: amountParam(d.defaultOutcome.merchantImpactIqd) }) : t('merchant.disputes.no_impact')}
        </Text>
      </View>
      {waiting && clock.hoursLeft !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <MIcon name="hourglass" size={18} color={clock.urgent ? 'dangerText' : 'warningText'} />
          <Text variant="label" weight={700} color={clock.urgent ? 'dangerText' : 'warningText'} tabular style={{ flex: 1 }}>
            {clock.hoursLeft >= 1 ? t('merchant.disputes.hours_left', { hours: clock.hoursLeft }) : t('merchant.disputes.minutes_left', { minutes: clock.minutesLeft ?? 0 })}
          </Text>
          <Text variant="label" weight={600} color="accentText">
            {t('merchant.disputes.answer_q')}
          </Text>
          <MIcon name="chevron-forward" size={18} color="accentText" />
        </View>
      ) : null}
    </Pressable>
  );
}

function DisputeSheet({ merchantOrgId, dispute: d, now, onClose }: { merchantOrgId: string; dispute: MerchantDispute; now: number; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const dates = useDates();
  const toast = useToast();
  const respond = useRespondDispute();
  const ticket = usePhotoTicket();
  const clock = disputeClock(d, now);
  const [editing, setEditing] = useState(clock.status === 'waiting');
  const [decision, setDecision] = useState<'accept_default' | 'contest' | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Array<PickedPhoto & { uploadId: string }>>([]);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    setEditing(disputeClock(d, Date.now()).status === 'waiting');
    setDecision(null);
    setNote('');
    setPhotos([]);
  }, [d.orderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const late = lateMinutes(d.evidence.promisedReadyAt, d.evidence.readyAt);
  const steps: Array<{ key: string; label: string; at: Date | null; note?: string; tone?: 'late' | 'ok' }> = [
    { key: 'accepted', label: t('merchant.disputes.ev_accepted'), at: d.evidence.acceptedAt },
    { key: 'promised', label: t('merchant.disputes.ev_promised'), at: d.evidence.promisedReadyAt },
    {
      key: 'ready',
      label: t('merchant.disputes.ev_ready'),
      at: d.evidence.readyAt,
      ...(late !== null ? (late > 1 ? { note: t('merchant.disputes.ev_late', { minutes: late }), tone: 'late' as const } : { note: t('merchant.disputes.ev_on_time'), tone: 'ok' as const }) : {}),
    },
    { key: 'picked', label: t('merchant.disputes.ev_picked'), at: d.evidence.pickedUpAt },
    { key: 'delivered', label: t('merchant.disputes.ev_delivered'), at: d.evidence.deliveredAt },
  ]
    .filter((s) => s.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime());

  const groups = new Map<string, MerchantDispute['evidence']['lines']>();
  for (const l of d.evidence.lines) {
    const k = l.participant ?? '';
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }

  const addPhoto = async () => {
    const picked = await pickPhoto();
    if (!picked) return;
    setUploading(true);
    try {
      const uploadId = await uploadPhoto(picked, (input) => ticket.mutateAsync(input));
      setPhotos((p) => [...p, { ...picked, uploadId }].slice(0, 5));
    } catch {
      toast.show({ message: t('merchant.disputes.upload_failed'), tone: 'danger' });
    } finally {
      setUploading(false);
    }
  };
  const send = async () => {
    if (!decision) return;
    if (!canSendAnswer(decision, note)) {
      toast.show({ message: t('merchant.disputes.note_required'), tone: 'warning' });
      return;
    }
    try {
      await respond.mutateAsync({ merchantOrgId, orderId: d.orderId, decision, ...(note.trim() ? { note: note.trim() } : {}), evidenceUploadIds: photos.map((p) => p.uploadId) });
      toast.show({ message: t('merchant.disputes.sent'), tone: 'success' });
      setEditing(false);
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    }
  };

  const status = STATUS[clock.status];
  return (
    <ModalSheet
      visible
      onClose={onClose}
      size="lg"
      testID="dispute-sheet"
      title={t(`merchant.disputes.kind_${d.kind}` as TKey)}
      subtitle={`${t('merchant.disputes.order', { ref: ticketNumber(d.orderId) })} · ${t('merchant.disputes.opened', { when: dates.when(d.openedAt, now) })}`}
      aside={<Tag label={t(status.key)} tone={status.tone} />}
      footer={
        editing ? (
          <Button
            testID="dispute-send"
            label={t('merchant.disputes.send')}
            icon="arrow-forward"
            size="lg"
            fullWidth
            variant={decision === 'accept_default' ? 'secondary' : 'primary'}
            disabled={!decision || uploading}
            loading={respond.isPending}
            onPress={() => void send()}
          />
        ) : clock.status !== 'default_applied' ? (
          <Button testID="dispute-change" label={t('merchant.disputes.change')} variant="secondary" size="lg" fullWidth onPress={() => setEditing(true)} />
        ) : undefined
      }
    >
      {d.note ? (
        <View style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[4], flexDirection: 'row', gap: theme.space[3] }}>
          <MIcon name="chat" size={20} color="textMuted" />
          <Text variant="body" style={{ flex: 1 }}>
            {`"${d.note}"`}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: theme.space[4], flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1, flexBasis: 260, gap: theme.space[3] }}>
          <Text variant="label" weight={700} color="textMuted">
            {t('merchant.disputes.evidence_title')}
          </Text>
          <View>
            {steps.map((s, i) => (
              <View key={s.key} style={{ flexDirection: 'row', gap: theme.space[3] }}>
                <View style={{ width: 14, alignItems: 'center' }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, marginTop: 7, backgroundColor: s.tone === 'late' ? theme.colors.warning : s.key === 'promised' ? theme.colors.surface : theme.colors.text, borderWidth: s.key === 'promised' ? 2 : 0, borderColor: theme.colors.textMuted }} />
                  {i < steps.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: theme.colors.border, marginVertical: 2 }} /> : null}
                </View>
                <View style={{ flex: 1, paddingBottom: theme.space[3] }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
                    <Text variant="body" color={s.key === 'promised' ? 'textMuted' : 'text'}>
                      {s.label}
                    </Text>
                    <Text variant="body" weight={600} tabular>
                      {clock12(s.at!)}
                    </Text>
                  </View>
                  {s.note ? (
                    <Text variant="caption" weight={600} color={s.tone === 'late' ? 'warningText' : 'successText'}>
                      {s.note}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
        <View style={{ flexGrow: 1, flexBasis: 240, gap: theme.space[3] }}>
          <Text variant="label" weight={700} color="textMuted">
            {t('merchant.disputes.packed_title')}
          </Text>
          <View style={{ backgroundColor: theme.colors.bg, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[3], gap: theme.space[2] }}>
            {[...groups.entries()].map(([who, lines]) => (
              <View key={who || 'orderer'} style={{ gap: 2 }}>
                {who ? (
                  <Text variant="caption" weight={700} color="accentText">
                    {t('merchant.per_person', { name: who })}
                  </Text>
                ) : null}
                {lines.map((l, i) => (
                  <Text key={i} variant="body" tabular>
                    {`${l.qty} × ${l.name}`}
                  </Text>
                ))}
              </View>
            ))}
            <Text variant="caption" color="textMuted" tabular>
              {t('merchant.disputes.items_total', { amount: amountParam(d.evidence.itemsIqd) })}
            </Text>
          </View>
        </View>
      </View>

      {d.evidence.photos.length > 0 || (d.response?.photoUrls.length ?? 0) > 0 ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label" weight={700} color="textMuted">
            {t('merchant.disputes.photos_title')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {[...d.evidence.photos, ...(d.response?.photoUrls ?? [])].map((u) => (
              <Image key={u} source={{ uri: absoluteUploadUrl(u) }} style={{ width: 96, height: 96, borderRadius: 14, backgroundColor: theme.colors.surfaceSunken }} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ backgroundColor: theme.colors.warningTint, borderRadius: theme.radius.lg, padding: theme.space[4], gap: 2 }}>
        <Text variant="label" weight={700} color="warningText">
          {t('merchant.disputes.default_title')}
        </Text>
        <Text variant="body">{d.defaultOutcome.text_ar}</Text>
        <Text variant="footnote" weight={600} color={d.defaultOutcome.merchantImpactIqd > 0 ? 'dangerText' : 'successText'} tabular>
          {d.defaultOutcome.merchantImpactIqd > 0 ? t('merchant.disputes.impact', { amount: amountParam(d.defaultOutcome.merchantImpactIqd) }) : t('merchant.disputes.no_impact')}
        </Text>
      </View>

      {!editing && d.response ? (
        <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, padding: theme.space[4], gap: theme.space[1] }}>
          <Text variant="label" weight={700} color="textMuted">
            {t('merchant.disputes.your_answer')}
          </Text>
          <Text variant="bodyStrong">{t(d.response.decision === 'contest' ? 'merchant.disputes.contest' : 'merchant.disputes.accept')}</Text>
          {d.response.note ? <Text variant="body">{d.response.note}</Text> : null}
          <Text variant="caption" color="textMuted" tabular>
            {dates.when(d.response.at, now)}
          </Text>
        </View>
      ) : null}

      {editing ? (
        <View style={{ gap: theme.space[3] }}>
          <Text variant="title">{t('merchant.disputes.answer_q')}</Text>
          {clock.hoursLeft !== null ? (
            <Text variant="footnote" weight={600} color={clock.urgent ? 'dangerText' : 'warningText'} tabular>
              {clock.hoursLeft >= 1 ? t('merchant.disputes.hours_left', { hours: clock.hoursLeft }) : t('merchant.disputes.minutes_left', { minutes: clock.minutesLeft ?? 0 })}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
            <Choice testID="answer-accept" icon="check" title={t('merchant.disputes.accept')} hint={t('merchant.disputes.accept_hint')} selected={decision === 'accept_default'} onPress={() => setDecision('accept_default')} />
            <Choice testID="answer-contest" icon="shield" title={t('merchant.disputes.contest')} hint={t('merchant.disputes.contest_hint')} selected={decision === 'contest'} onPress={() => setDecision('contest')} />
          </View>
          {decision === 'contest' ? (
            <View style={{ gap: theme.space[3] }}>
              <TextField testID="answer-note" value={note} onChangeText={setNote} placeholder={t('merchant.disputes.note_placeholder')} multiline maxLength={500} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], alignItems: 'center' }}>
                {photos.map((p) => (
                  <Image key={p.uploadId} source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 12 }} />
                ))}
                {photos.length < 5 ? (
                  <Pressable
                    testID="answer-photo"
                    accessibilityRole="button"
                    onPress={() => void addPhoto()}
                    style={{ width: 72, height: 72, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 2 }}
                  >
                    <MIcon name={uploading ? 'hourglass' : 'plus'} size={22} color="textMuted" />
                    <Text variant="caption" color="textMuted">
                      {t('merchant.disputes.add_photo')}
                    </Text>
                  </Pressable>
                ) : null}
                <Text variant="caption" color="textMuted" tabular>
                  {t('merchant.disputes.photo_count', { count: photos.length })}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
    </ModalSheet>
  );
}

function Choice({ icon, title, hint, selected, onPress, testID }: { icon: MIconName; title: string; hint: string; selected: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 96,
        padding: theme.space[4],
        gap: theme.space[1],
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.text : theme.colors.border,
        backgroundColor: selected ? theme.colors.surfaceSunken : theme.colors.surface,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <MIcon name={icon} size={20} color={selected ? 'text' : 'textMuted'} strokeWidth={2} />
        <Text variant="bodyStrong">{title}</Text>
      </View>
      <Text variant="caption" color="textMuted">
        {hint}
      </Text>
    </Pressable>
  );
}
