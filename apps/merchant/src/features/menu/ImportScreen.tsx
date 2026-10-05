import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, View } from 'react-native';
import type { MenuImportJob } from '@driver/contracts';
import { Button, Skeleton, Text, TextField, useTheme, useToast, withAlpha } from '@driver/ui';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { Glyph, type GlyphName } from './Glyph';
import { categoryNames, checkImport, emptyRow, rowProblems, type ImportRow } from './logic';
import { absoluteUrl, pickPhotos, type PickedPhoto } from './photo';
import { GlyphButton, Panel, Pill } from './parts';
import { useImportActions, useImportJob, useMenu, usePhotoUpload } from './queries';
import { color } from '@driver/design-tokens';

type Stage = 'photos' | 'reading' | 'review' | 'done';
const STAGES: readonly Stage[] = ['photos', 'reading', 'review', 'done'];
const STAGE_LABEL = { photos: 'merchant.import.step_photos', reading: 'merchant.import.step_reading', review: 'merchant.import.step_review', done: 'merchant.import.step_done' } as const;

/**
 * المنيو من الصور: photograph the paper menu → upload → the import job (OCR reads it where it runs;
 * otherwise staff type) → a correction table beside the photos → apply. The job id stays in the URL
 * so a reload comes back to the same table.
 */
export function ImportScreen() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const { wide } = useLayout();
  const params = useLocalSearchParams<{ job?: string }>();
  const jobId = typeof params.job === 'string' && params.job ? params.job : null;
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const job = useImportJob(storeId, jobId);
  const menu = useMenu(storeId);
  const actions = useImportActions();
  const upload = usePhotoUpload();

  const [picked, setPicked] = useState<PickedPhoto[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [rowsFor, setRowsFor] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [tried, setTried] = useState(false);

  // First rows: what the reader found, or one empty row per photo to start typing.
  useEffect(() => {
    const j = job.data;
    if (!j || rowsFor === j.jobId) return;
    setRows(j.items.length > 0 ? j.items.map((i) => ({ ...emptyRow(i.categoryAr ?? '', i.sourceUploadId ?? null), nameAr: i.nameAr, price: String(i.priceIqd) })) : [emptyRow('', j.photoUploadIds[0] ?? null)]);
    setRowsFor(j.jobId);
  }, [job.data, rowsFor]);

  const stage: Stage = !jobId ? (progress ? 'reading' : 'photos') : !job.data ? 'reading' : job.data.state === 'applied' ? 'done' : 'review';
  const sections = useMemo(() => categoryNames(menu.data?.categories ?? []), [menu.data]);
  const check = useMemo(() => checkImport(rows), [rows]);
  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });

  const addPhotos = async (source: 'camera' | 'library') => {
    const res = await pickPhotos(source, { multiple: true });
    if (res === 'denied') {
      toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
      return;
    }
    if (res) setPicked((p) => [...p, ...res].slice(0, 10));
  };

  const start = async () => {
    if (!storeId || picked.length === 0) return;
    setProgress({ done: 0, total: picked.length });
    try {
      const ids: string[] = [];
      for (const p of picked) {
        ids.push(await upload(p));
        setProgress({ done: ids.length, total: picked.length });
      }
      const created = await actions.start.mutateAsync({ merchantOrgId: storeId, uploadIds: ids });
      router.setParams({ job: created.jobId });
    } catch (err) {
      fail(err);
    } finally {
      setProgress(null);
    }
  };

  const apply = () => {
    setTried(true);
    if (!storeId || !jobId || check.problems > 0 || check.ready.length === 0) return;
    actions.apply.mutate(
      { merchantOrgId: storeId, jobId, items: check.ready },
      { onSuccess: (j) => toast.show({ message: t('merchant.import.applied_toast', { count: j.appliedCount }), tone: 'success' }), onError: fail },
    );
  };

  const patchRow = (key: string, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    const last = rows[rows.length - 1];
    setRows((rs) => [...rs, emptyRow(last?.categoryAr ?? '', job.data?.photoUploadIds[photoIdx] ?? null)]);
  };

  const steps = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
      {STAGES.map((s, i) => {
        const order = STAGES.indexOf(stage);
        const state = i < order ? 'done' : i === order ? 'current' : 'next';
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
            {i > 0 ? <View style={{ width: wide ? 28 : 12, height: 2, borderRadius: 1, backgroundColor: state === 'next' ? theme.colors.border : theme.colors.accent }} /> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: state === 'next' ? theme.colors.surfaceSunken : theme.colors.accent }}>
                {state === 'done' ? (
                  <Glyph name="check" size={15} color="onAccent" strokeWidth={2.5} />
                ) : (
                  <Text variant="caption" weight={700} color={state === 'next' ? 'textMuted' : 'onAccent'}>
                    {i + 1}
                  </Text>
                )}
              </View>
              {wide || state === 'current' ? (
                <Text variant="label" weight={state === 'current' ? 700 : 500} color={state === 'next' ? 'textMuted' : 'text'}>
                  {t(STAGE_LABEL[s])}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );

  // ── stage: choose photos ──
  if (stage === 'photos' || stage === 'reading') {
    const busy = stage === 'reading';
    return (
      <Page title={t('merchant.import.title')} subtitle={t('merchant.import.subtitle')} back testID="menu-import-screen" maxWidth={wide ? 1000 : 760}>
        {steps}
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space[5], alignItems: 'flex-start' }}>
          <Panel style={{ flex: wide ? 1 : undefined, alignSelf: 'stretch' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
              {picked.map((p, i) => (
                <View key={`${p.uri}-${i}`} style={{ width: wide ? 148 : 100, aspectRatio: 3 / 4, borderRadius: theme.radius.lg, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
                  <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                  <View style={{ position: 'absolute', top: 6, start: 6, paddingHorizontal: 8, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: withAlpha(color.neutral[900], 0.7) }}>
                    <Text variant="caption" weight={700} style={{ color: color.neutral[0] }} tabular>
                      {i + 1}
                    </Text>
                  </View>
                  {!busy ? (
                    <View style={{ position: 'absolute', top: 4, end: 4 }}>
                      <GlyphButton glyph="x" size={36} variant="outline" label={t('merchant.import.remove_photo', { n: i + 1 })} onPress={() => setPicked((ps) => ps.filter((_, j) => j !== i))} />
                    </View>
                  ) : null}
                </View>
              ))}
              {picked.length < 10 && !busy ? (
                <Pressable
                  testID="import-pick"
                  accessibilityRole="button"
                  onPress={() => void addPhotos('library')}
                  style={({ pressed }) => ({ width: wide ? 148 : 100, aspectRatio: 3 / 4, borderRadius: theme.radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.accent, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center', gap: theme.space[2], opacity: pressed ? 0.75 : 1 })}
                >
                  <Glyph name="photo" size={28} color="accentText" />
                  <Text variant="label" weight={600} color="accentText" align="center">
                    {picked.length === 0 ? t('merchant.import.pick_first') : t('merchant.import.pick_more')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {Platform.OS !== 'web' && !busy ? <Button variant="secondary" label={t('merchant.item.photo_camera')} trailing={<Glyph name="camera" size={18} strokeWidth={2} />} onPress={() => void addPhotos('camera')} /> : null}
            <Button
              testID="import-start"
              size="lg"
              fullWidth
              disabled={picked.length === 0}
              loading={busy}
              loadingLabel={progress ? t('merchant.import.uploading', { done: progress.done, total: progress.total }) : undefined}
              label={picked.length > 0 ? t('merchant.import.start', { count: picked.length }) : t('merchant.import.start_empty')}
              onPress={() => void start()}
            />
          </Panel>
          <View style={{ width: wide ? 320 : undefined, alignSelf: 'stretch', gap: theme.space[3] }}>
            <Text variant="title">{t('merchant.import.tips_title')}</Text>
            <Tip glyph="photo" text={t('merchant.import.tip_page')} />
            <Tip glyph="sparkle" text={t('merchant.import.tip_light')} />
            <Tip glyph="cash" text={t('merchant.import.tip_prices')} />
            <Tip glyph="pencil" text={t('merchant.import.tip_review')} />
          </View>
        </View>
      </Page>
    );
  }

  const j = job.data as MenuImportJob;

  // ── stage: applied ──
  if (stage === 'done') {
    return (
      <Page title={t('merchant.import.title')} back testID="menu-import-screen" maxWidth={760}>
        {steps}
        <Panel style={{ alignItems: 'center', paddingVertical: theme.space[10], gap: theme.space[4] }} testID="import-done">
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <Glyph name="check" size={38} color="successText" strokeWidth={2.4} />
          </View>
          <Text variant="heading" align="center">
            {t('merchant.import.done_title', { count: j.appliedCount })}
          </Text>
          <Text variant="body" color="textMuted" align="center" style={{ maxWidth: 440 }}>
            {t('merchant.import.done_body')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <Button variant="secondary" label={t('merchant.import.again')} onPress={() => router.replace('/menu/import')} />
            <Button testID="import-to-menu" label={t('merchant.import.to_menu')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/menu'))} />
          </View>
        </Panel>
      </Page>
    );
  }

  // ── stage: review (correction table) ──
  const photos = j.photoUrls.length > 0 ? j.photoUrls : j.photoUploadIds.map(() => '');
  const current = photos[Math.min(photoIdx, photos.length - 1)] ?? '';
  const ocrNote = j.ocr === 'done' ? t('merchant.import.ocr_done', { count: j.items.length }) : t('merchant.import.ocr_stub');

  const viewer = (
    <Panel padded={false} style={{ overflow: 'hidden' }}>
      <View style={{ aspectRatio: wide ? 3 / 4 : 4 / 3, backgroundColor: theme.colors.surfaceSunken }}>
        {current ? <Image testID="import-photo" source={{ uri: absoluteUrl(current) }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : <Skeleton height={320} />}
      </View>
      {photos.length > 1 ? (
        <ScrollView horizontal contentContainerStyle={{ gap: theme.space[2], padding: theme.space[3] }}>
          {photos.map((u, i) => (
            <Pressable key={`${u}-${i}`} accessibilityRole="button" accessibilityLabel={t('merchant.import.photo_n', { n: i + 1 })} onPress={() => setPhotoIdx(i)} style={{ width: 52, height: 64, borderRadius: theme.radius.md, overflow: 'hidden', borderWidth: 2, borderColor: i === photoIdx ? theme.colors.accent : 'transparent' }}>
              {u ? <Image source={{ uri: absoluteUrl(u) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </Panel>
  );

  const table = (
    <Panel padded={false} testID="import-table">
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingTop: theme.space[3], paddingBottom: theme.space[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Text variant="caption" weight={600} color="textMuted" style={{ width: 28 }}>
            #
          </Text>
          <Text variant="caption" weight={600} color="textMuted" style={{ flex: 2.2 }}>
            {t('merchant.import.col_item')}
          </Text>
          <Text variant="caption" weight={600} color="textMuted" style={{ flex: 1.1 }}>
            {t('merchant.import.col_price')}
          </Text>
          <Text variant="caption" weight={600} color="textMuted" style={{ flex: 1.5 }}>
            {t('merchant.import.col_section')}
          </Text>
          <View style={{ width: 40 }} />
        </View>
      ) : null}
      {rows.map((r, i) => {
        const p = tried || (r.nameAr && r.price) ? rowProblems(r) : [];
        const fields = (
          <>
            <TextField testID={`import-name-${i}`} placeholder={t('merchant.import.ph_item')} value={r.nameAr} onChangeText={(v) => patchRow(r.key, { nameAr: v })} style={{ flex: wide ? 2.2 : undefined }} error={p.includes('name') ? t('merchant.import.err_name') : undefined} maxLength={80} />
            <View style={{ flexDirection: 'row', gap: theme.space[2], flex: wide ? 2.6 : undefined }}>
              <TextField testID={`import-price-${i}`} placeholder={t('merchant.import.ph_price')} value={r.price} onChangeText={(v) => patchRow(r.key, { price: v })} keyboardType="number-pad" style={{ flex: 1.1 }} error={p.includes('price') ? t('merchant.import.err_price') : undefined} />
              <TextField testID={`import-section-${i}`} placeholder={t('merchant.import.ph_section')} value={r.categoryAr} onChangeText={(v) => patchRow(r.key, { categoryAr: v })} style={{ flex: 1.5 }} maxLength={40} />
            </View>
          </>
        );
        return (
          <View key={r.key} style={{ flexDirection: wide ? 'row' : 'column', alignItems: wide ? 'flex-start' : 'stretch', gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
            {wide ? (
              <View style={{ width: 28, height: 52, justifyContent: 'center' }}>
                <Text variant="label" color="textMuted" tabular>
                  {i + 1}
                </Text>
              </View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text variant="label" weight={700} color="textMuted" style={{ flex: 1 }} tabular>
                  {t('merchant.import.row_n', { n: i + 1 })}
                </Text>
                <GlyphButton glyph="trash" size={36} variant="plain" color="textMuted" label={t('merchant.import.remove_row', { n: i + 1 })} onPress={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))} />
              </View>
            )}
            {fields}
            {wide ? (
              <View style={{ height: 52, justifyContent: 'center' }}>
                <GlyphButton glyph="trash" size={40} variant="plain" color="textMuted" label={t('merchant.import.remove_row', { n: i + 1 })} onPress={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [emptyRow()]))} />
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={{ padding: theme.space[3], borderTopWidth: 1, borderTopColor: theme.colors.border, gap: theme.space[2] }}>
        <Pressable testID="import-add-row" accessibilityRole="button" onPress={addRow} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 44, paddingHorizontal: theme.space[2], opacity: pressed ? 0.7 : 1 })}>
          <Glyph name="plus" size={20} color="accentText" strokeWidth={2} />
          <Text variant="bodyStrong" color="accentText">
            {t('merchant.import.add_row')}
          </Text>
        </Pressable>
        {sections.length > 0 ? (
          <Text variant="caption" color="textMuted">
            {t('merchant.import.sections_hint', { sections: sections.slice(0, 6).join('، ') })}
          </Text>
        ) : null}
      </View>
    </Panel>
  );

  const footer = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], flexWrap: 'wrap' }}>
      <View style={{ flexDirection: 'row', gap: theme.space[2], flex: 1, flexWrap: 'wrap' }}>
        <Pill tone="success" dot label={t('merchant.import.ready_count', { count: check.ready.length })} />
        {check.problems > 0 ? <Pill tone="danger" dot label={t('merchant.import.fix_count', { count: check.problems })} /> : null}
      </View>
      <Button testID="import-apply" size="lg" label={t('merchant.import.apply', { count: check.ready.length })} disabled={check.ready.length === 0 || check.problems > 0} loading={actions.apply.isPending} onPress={apply} style={{ minWidth: wide ? 260 : undefined, flex: wide ? undefined : 1 }} />
    </View>
  );

  return (
    <Page title={t('merchant.import.title')} subtitle={t('merchant.import.photos_count', { count: photos.length })} back testID="menu-import-screen" maxWidth={wide ? 1240 : 760}>
      {steps}
      <View style={{ flexDirection: 'row', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: j.ocr === 'done' ? theme.colors.successTint : theme.colors.infoTint }}>
        <Glyph name={j.ocr === 'done' ? 'sparkle' : 'info'} size={20} color={j.ocr === 'done' ? 'successText' : 'infoText'} />
        <Text variant="footnote" color="text" style={{ flex: 1 }}>
          {ocrNote}
        </Text>
      </View>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'flex-start' }}>
          <View style={{ width: 380 }}>{viewer}</View>
          <View style={{ flex: 1, gap: theme.space[4] }}>
            {table}
            {footer}
          </View>
        </View>
      ) : (
        <>
          {viewer}
          {table}
          {footer}
        </>
      )}
    </Page>
  );
}

function Tip({ glyph, text }: { glyph: GlyphName; text: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'flex-start' }}>
      <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name={glyph} size={18} color="accentText" strokeWidth={2} />
      </View>
      <Text variant="body" style={{ flex: 1, paddingTop: 4 }}>
        {text}
      </Text>
    </View>
  );
}
