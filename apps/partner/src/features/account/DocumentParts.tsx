import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import type { DocumentsView, DriverDocumentKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { Button, Card, Icon, IconButton, StatusPill, Text, useTheme, useToast } from '@driver/ui';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { Glyph, type GlyphName } from './Glyph';
import { DOC_STATUS_KEY, DOC_TONE, docAction, docsSummary, expiryFromMonth, expiryText, dayMonth, hasExpiry, local, type DocRow } from './logic';
import { ModalSheet } from './ModalSheet';
import { pickPhoto, uploadPhoto, type PickedPhoto, type PhotoSource } from './photo';
import { useAccountMutations, useRefreshAccount } from './queries';

const KIND_GLYPH: Record<DriverDocumentKind, GlyphName> = {
  national_id_front: 'id-card',
  national_id_back: 'id-card',
  licence: 'id-card',
  vehicle_registration: 'document',
  insurance: 'document',
  photo: 'face',
};

/** The state of his papers in one line: blocked (expired), action needed, under review, all fine. */
export function DocsSummaryCard({ view }: { view: DocumentsView }) {
  const theme = useTheme();
  const t = useT();
  const s = docsSummary(view);
  const c = {
    blocked: { bg: theme.colors.dangerTint, fg: 'dangerText', glyph: 'lock' as GlyphName, title: t('partner.docs_blocked'), body: t('partner.docs_blocked_body') },
    action: { bg: theme.colors.warningTint, fg: 'warningText', glyph: 'alert' as GlyphName, title: t('partner.docs_action_needed'), body: t('partner.docs_action_body') },
    review: { bg: theme.colors.infoTint, fg: 'infoText', glyph: 'document' as GlyphName, title: t('partner.docs_review_title'), body: t('partner.docs_review_body') },
    ok: { bg: theme.colors.successTint, fg: 'successText', glyph: null, title: t('partner.docs_all_good'), body: t('partner.docs_all_good_body') },
  }[s];
  return (
    <View testID={`docs-summary-${s}`} style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center', backgroundColor: c.bg, borderRadius: theme.radius.xl, padding: theme.space[4] }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
        {c.glyph ? <Glyph name={c.glyph} size={22} color={c.fg} /> : <Icon name="check" size={22} color={c.fg} strokeWidth={2.6} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} color={c.fg}>
          {c.title}
        </Text>
        <Text variant="footnote" color="text">
          {c.body}
        </Text>
      </View>
    </View>
  );
}

/** One document: what it is, its state (days left, why it was rejected), and the one thing to do. */
export function DocumentRow({ row, onUpload, divider }: { row: DocRow; onUpload: () => void; divider: boolean }) {
  const theme = useTheme();
  const t = useT();
  const action = docAction(row.status);
  const tone = DOC_TONE[row.status];
  const d = row.doc;
  const expiry = d ? expiryText(d.daysToExpiry, t) : null;
  const sub =
    row.status === 'missing'
      ? t(`partner.docs_hint_${row.kind}`)
      : row.status === 'pending'
        ? t('partner.docs_submitted', { date: dayMonth(d!.submittedAt, t) })
        : row.status === 'expiring' || row.status === 'expired'
          ? expiry
          : d?.expiresAt
            ? t('partner.docs_valid_until', { date: `${dayMonth(d.expiresAt, t)} ${local(d.expiresAt).year}` })
            : t(`partner.docs_hint_${row.kind}`);
  const tileBg = { success: theme.colors.successTint, warning: theme.colors.warningTint, danger: theme.colors.dangerTint, info: theme.colors.infoTint, neutral: theme.colors.surfaceSunken }[tone];
  const tileFg = { success: 'successText', warning: 'warningText', danger: 'dangerText', info: 'infoText', neutral: 'textMuted' }[tone];
  return (
    <View testID={`doc-${row.kind}`} style={{ padding: theme.space[4], gap: theme.space[3], borderBottomWidth: divider ? 1 : 0, borderBottomColor: theme.colors.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
          <Glyph name={KIND_GLYPH[row.kind]} size={22} color={tileFg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="label" weight={600}>
            {t(`partner.docs_kind_${row.kind}`)}
          </Text>
          <Text variant="caption" color={row.status === 'expired' ? 'dangerText' : row.status === 'expiring' ? 'warningText' : 'textMuted'} weight={row.status === 'expiring' || row.status === 'expired' ? 600 : 400} tabular numberOfLines={2}>
            {sub}
          </Text>
        </View>
        <StatusPill size="sm" tone={tone} dot={row.status !== 'approved'} icon={row.status === 'approved' ? 'check' : undefined} label={t(DOC_STATUS_KEY[row.status])} />
      </View>
      {row.status === 'rejected' && d?.rejectReason ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], backgroundColor: theme.colors.dangerTint, borderRadius: theme.radius.md, padding: theme.space[3] }}>
          <Glyph name="alert" size={16} color="dangerText" />
          <Text variant="footnote" color="dangerText" style={{ flex: 1 }}>
            {t('partner.docs_reject_reason', { reason: d.rejectReason })}
          </Text>
        </View>
      ) : null}
      {action ? (
        <Button
          testID={`doc-${row.kind}-action`}
          label={t(action)}
          icon={action === 'partner.docs_renew' ? undefined : 'plus'}
          size="md"
          variant={row.status === 'expired' || row.status === 'rejected' ? 'primary' : 'secondary'}
          fullWidth
          onPress={onUpload}
        />
      ) : null}
    </View>
  );
}

/**
 * Upload sheet: take or choose the photo, see it, give the expiry for papers that carry one, send.
 * The photo goes up through `places.photoUpload` (signed PUT) and the upload id to
 * `driverAccount.uploadDocument`; a new upload of a kind replaces the old one.
 */
export function UploadDocumentSheet({ kind, onClose }: { kind: DriverDocumentKind | null; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const m = useAccountMutations();
  const refresh = useRefreshAccount();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = local(new Date());
  const [expiry, setExpiry] = useState({ year: now.year + 1, month: now.month });

  useEffect(() => {
    setPhoto(null);
    setError(null);
    setExpiry({ year: now.year + 1, month: now.month });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const pick = async (source: PhotoSource) => {
    setError(null);
    const got = await pickPhoto(source);
    if (got === 'denied') setError(t('partner.docs_camera_denied'));
    else if (got) setPhoto(got);
  };

  const submit = async () => {
    if (!kind || !photo) return;
    setBusy(true);
    setError(null);
    try {
      const uploadId = await uploadPhoto(photo, (input) => m.ticket.mutateAsync(input));
      await m.uploadDocument.mutateAsync({ kind, uploadId, ...(hasExpiry(kind) ? { expiresAt: expiryFromMonth(expiry.year, expiry.month) } : {}) });
      theme.haptic('success');
      toast.show({ message: t('partner.docs_sent'), tone: 'success', icon: 'check' });
      await refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error && /^(upload_|photo_size)/.test(err.message) ? t('partner.docs_upload_failed') : apiErrorMessage(err, t('partner.docs_upload_failed'), locale));
    } finally {
      setBusy(false);
    }
  };

  const shiftMonth = (delta: number) =>
    setExpiry((e) => {
      const i = e.year * 12 + (e.month - 1) + delta;
      const min = now.year * 12 + (now.month - 1);
      const j = Math.max(min, Math.min(min + 12 * 15, i));
      return { year: Math.floor(j / 12), month: (j % 12) + 1 };
    });

  return (
    <ModalSheet visible={kind !== null} onClose={() => (busy ? undefined : onClose())} title={kind ? t('partner.docs_upload_title', { doc: t(`partner.docs_kind_${kind}`) }) : undefined} testID="upload-sheet" locked={busy}>
      {kind ? (
        <>
          <Text variant="body" color="textMuted">
            {t(`partner.docs_hint_${kind}`)}
          </Text>
          {photo ? (
            <View style={{ gap: theme.space[2] }}>
              <Image testID="upload-preview" source={{ uri: photo.uri }} resizeMode="cover" style={{ width: '100%', height: 190, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }} />
              <Text variant="label" weight={600} color="accentText" align="center" onPress={() => (busy ? undefined : setPhoto(null))} accessibilityRole="button">
                {t('partner.docs_change_photo')}
              </Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
              <PickTile testID="upload-camera" glyph="camera" label={t('partner.docs_pick_camera')} onPress={() => void pick('camera')} primary />
              <PickTile testID="upload-library" glyph="upload" label={t('partner.docs_pick_library')} onPress={() => void pick('library')} />
            </View>
          )}
          {!photo ? (
            <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'center' }}>
              <Glyph name="camera" size={15} color="textMuted" />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t('partner.docs_photo_tips')}
              </Text>
            </View>
          ) : null}
          {photo && hasExpiry(kind) ? (
            <View testID="upload-expiry" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
              <Glyph name="calendar" size={20} color="textMuted" />
              <View style={{ flex: 1 }}>
                <Text variant="caption" color="textMuted">
                  {t('partner.docs_expiry_label')}
                </Text>
                <Text variant="label" weight={600} tabular>{`${t(`partner.month_${expiry.month}` as MessageKey)} ${expiry.year}`}</Text>
              </View>
              <IconButton icon="minus" size={36} variant="outline" accessibilityLabel="−" onPress={() => shiftMonth(-1)} />
              <IconButton icon="plus" size={36} variant="outline" accessibilityLabel="+" onPress={() => shiftMonth(1)} />
            </View>
          ) : null}
          {error ? (
            <Text testID="upload-error" variant="footnote" color="dangerText">
              {error}
            </Text>
          ) : null}
          <Button testID="upload-submit" label={t('partner.docs_submit')} loading={busy} loadingLabel={t('partner.docs_uploading')} disabled={!photo} fullWidth size="lg" onPress={() => void submit()} />
        </>
      ) : null}
    </ModalSheet>
  );
}

function PickTile({ glyph, label, onPress, primary, testID }: { glyph: GlyphName; label: string; onPress: () => void; primary?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={() => {
        theme.haptic('light');
        onPress();
      }}
      style={({ pressed }) => ({
        flex: 1,
        height: 120,
        borderRadius: theme.radius.xl,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: primary ? theme.colors.accent : theme.colors.borderStrong,
        backgroundColor: primary ? theme.colors.accentTint : theme.colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
        gap: theme.space[2],
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <Glyph name={glyph} size={28} color={primary ? 'accentText' : 'text'} />
      <Text variant="label" weight={600} color={primary ? 'accentText' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

export function DocsSection({ title, rows, onUpload }: { title: string; rows: DocRow[]; onUpload: (kind: DriverDocumentKind) => void }) {
  const theme = useTheme();
  if (rows.length === 0) return null;
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[1] }}>
        {title}
      </Text>
      <Card elevation={1} padding={0} style={{ overflow: 'hidden' }}>
        {rows.map((r, i) => (
          <DocumentRow key={r.kind} row={r} onUpload={() => onUpload(r.kind)} divider={i < rows.length - 1} />
        ))}
      </Card>
    </View>
  );
}
