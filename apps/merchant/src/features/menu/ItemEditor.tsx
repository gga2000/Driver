import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, Platform, Pressable, View } from 'react-native';
import { DISH_LABELS, type AdminMenuItem, type DishLabel } from '@driver/contracts';
import { Button, ChipGroup, EmptyState, SegmentedControl, Skeleton, Stepper, Text, TextField, useTheme, withAlpha } from '@driver/ui';
import { useCounterToast } from '@/lib/toast';
import { LoadPending } from '@/components/Loadable';
import { Page } from '@/components/Page';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { amountParam, iqd } from '@/lib/money';
import { Glyph } from './Glyph';
import { GroupSheet, HistorySheet, PriceSheet, ruleText, TierSheet } from './ItemSheets';
import { categoryNames, draftKey, fromDraftGroups, itemStatus, offStep, parsePrice, sortOrderForNew, toDraftGroups, type DraftGroup } from './logic';
import { LibrarySheet, libraryPhoto } from './LibrarySheet';
import { absoluteUrl, pickPhotos, type PickedPhoto } from './photo';
import { DishArt, Panel, PanelTitle, Pill, Toggle } from './parts';
import { applyTiers, draftTiersOf, dropTiers, TIER_GROUP, type Tier, type TierKind } from './tiers';
import { COUNTER } from '@/lib/counter';
import { useMenu, useMenuActions, usePhotoUpload, usePriceHistory } from './queries';
import { color } from '@driver/design-tokens';

interface Basics {
  nameAr: string;
  nameEn: string;
  description: string;
  categoryAr: string;
  prepTimeMin: number;
  price: string;
  /** The kitchen's labels shown to customers (joy o8): «حار», «جديد», «للعائلة». */
  labels: DishLabel[];
}

function basicsOf(item: AdminMenuItem | null, category: string | null): Basics {
  return {
    nameAr: item?.nameAr ?? '',
    nameEn: item?.nameEn ?? '',
    description: item?.description ?? '',
    categoryAr: item?.categoryAr ?? category ?? '',
    prepTimeMin: item?.prepTimeMin ?? 15,
    price: item ? String(item.priceIqd) : '',
    labels: [...(item?.labels ?? [])],
  };
}

/**
 * One dish: photo, names, section, prep time; the price (with its history) and options groups save on
 * their own sheets because customers see them at once. A new dish saves everything in one go.
 */
export function ItemEditor() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const { wide } = useLayout();
  const params = useLocalSearchParams<{ id?: string; category?: string; photo?: string }>();
  // p1: opened from a tray's «ماكو صورة · دوس وصوّر»: the photo panel leads.
  const forPhoto = params.photo === '1';
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const menu = useMenu(storeId);
  const actions = useMenuActions(storeId);
  const upload = usePhotoUpload();
  const itemId = typeof params.id === 'string' && params.id ? params.id : null;
  const item = useMemo(() => (itemId ? (menu.data?.categories.flatMap((c) => c.items).find((i) => i.id === itemId) ?? null) : null), [menu.data, itemId]);
  const isNew = itemId === null;
  const sections = useMemo(() => categoryNames(menu.data?.categories ?? []), [menu.data]);

  const [form, setForm] = useState<Basics>(() => basicsOf(null, typeof params.category === 'string' ? params.category : null));
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [groups, setGroups] = useState<DraftGroup[]>([]);
  const [newSection, setNewSection] = useState(false);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tried, setTried] = useState(false);
  const [priceOpen, setPriceOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [groupEdit, setGroupEdit] = useState<{ group: DraftGroup; isNew: boolean } | null>(null);
  const [tierEdit, setTierEdit] = useState<TierKind | null>(null);
  const [tierBusy, setTierBusy] = useState(false);
  const history = usePriceHistory(storeId, historyOpen ? itemId : null);

  // Fill the form once the dish arrives (and again if another dish opens in this screen).
  useEffect(() => {
    if (item && loadedFor !== item.id) {
      setForm(basicsOf(item, null));
      setGroups(toDraftGroups(item.modifierGroups));
      setLoadedFor(item.id);
    }
  }, [item, loadedFor]);

  const fail = (err: unknown) => toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
  const set = <K extends keyof Basics>(k: K, v: Basics[K]) => setForm((f) => ({ ...f, [k]: v }));

  const price = parsePrice(form.price);
  const nameOk = form.nameAr.trim().length >= 1;
  const original = item ? basicsOf(item, null) : null;
  const dirty = isNew || (original !== null && (['nameAr', 'nameEn', 'description', 'categoryAr', 'prepTimeMin'] as const).some((k) => form[k] !== original[k]));

  const choosePhoto = async (source: 'camera' | 'library') => {
    const picked = await pickPhotos(source, { square: true });
    if (picked === 'denied') {
      toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
      return;
    }
    if (picked?.[0]) await applyPhoto(picked[0]);
  };
  // A new dish keeps the photo until it is saved; a saved one swaps its photo now.
  const applyPhoto = async (picked: PickedPhoto): Promise<boolean> => {
    if (!storeId) return false;
    if (isNew || !item) {
      setPhoto(picked);
      return true;
    }
    setUploading(true);
    try {
      const uploadId = await upload(picked);
      await actions.replacePhoto.mutateAsync({ merchantOrgId: storeId, itemId: item.id, uploadId });
      toast.show({ message: t('merchant.item.photo_done'), tone: 'success' });
      return true;
    } catch (err) {
      fail(err);
      return false;
    } finally {
      setUploading(false);
    }
  };
  const pickFromLibrary = async (source: number | string) => {
    try {
      if (await applyPhoto(await libraryPhoto(source))) setLibraryOpen(false);
    } catch (err) {
      fail(err);
    }
  };

  const saveBasics = async () => {
    setTried(true);
    if (!storeId || !nameOk || (isNew && price === null)) return;
    const categoryAr = form.categoryAr.trim() || null;
    setSaving(true);
    try {
      if (isNew) {
        const created = await actions.upsertItem.mutateAsync({
          merchantOrgId: storeId,
          nameAr: form.nameAr.trim(),
          nameEn: form.nameEn.trim() || null,
          description: form.description.trim() || null,
          priceIqd: price!,
          categoryAr,
          sortOrder: sortOrderForNew(menu.data?.categories ?? [], categoryAr),
          prepTimeMin: form.prepTimeMin,
          labels: form.labels,
        });
        if (groups.length > 0) await actions.setModifiers.mutateAsync({ merchantOrgId: storeId, itemId: created.id, groups: fromDraftGroups(groups) });
        if (photo) {
          const uploadId = await upload(photo);
          await actions.replacePhoto.mutateAsync({ merchantOrgId: storeId, itemId: created.id, uploadId });
        }
        toast.show({ message: t('merchant.item.created', { name: created.nameAr }), tone: 'success' });
        router.replace({ pathname: '/menu/item', params: { id: created.id } });
        return;
      }
      if (!item) return;
      const moved = categoryAr !== item.categoryAr;
      await actions.upsertItem.mutateAsync({
        merchantOrgId: storeId,
        itemId: item.id,
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim() || null,
        description: form.description.trim() || null,
        priceIqd: item.priceIqd,
        categoryAr,
        ...(moved ? { sortOrder: sortOrderForNew(menu.data?.categories ?? [], categoryAr) } : {}),
        prepTimeMin: form.prepTimeMin,
        labels: form.labels,
      });
      toast.show({ message: t('merchant.item.saved'), tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const savePrice = (priceIqd: number) => {
    if (!storeId || !item) return;
    actions.updatePrice.mutate(
      { merchantOrgId: storeId, itemId: item.id, priceIqd },
      {
        onSuccess: () => {
          setPriceOpen(false);
          toast.show({ message: t('merchant.item.price_done', { amount: amountParam(priceIqd) }), tone: 'success' });
        },
        onError: fail,
      },
    );
  };

  const saveGroups = (next: DraftGroup[], done: () => void) => {
    if (isNew || !item || !storeId) {
      setGroups(next);
      done();
      return;
    }
    actions.setModifiers.mutate(
      { merchantOrgId: storeId, itemId: item.id, groups: fromDraftGroups(next) },
      {
        onSuccess: (saved) => {
          setGroups(toDraftGroups(saved.modifierGroups));
          done();
          toast.show({ message: t('merchant.item.options_saved'), tone: 'success' });
        },
        onError: fail,
      },
    );
  };

  // k2 / k3: sold by weight or by size. The dish's price becomes the cheapest one and a required
  // «الوزن» / «الحجم» choice adds the rest (tiers.ts); a new dish keeps both in the form until it saves.
  const tiers = draftTiersOf(isNew ? price : (item?.priceIqd ?? null), groups);
  const soldBy: 'one' | TierKind = tiers?.kind ?? 'one';

  const saveTiers = async (kind: TierKind, list: Tier[]) => {
    const next = applyTiers(kind, list, groups);
    if (isNew || !item || !storeId) {
      setGroups(next.groups);
      set('price', String(next.priceIqd));
      setTierEdit(null);
      return;
    }
    setTierBusy(true);
    try {
      const saved = await actions.setModifiers.mutateAsync({ merchantOrgId: storeId, itemId: item.id, groups: fromDraftGroups(next.groups) });
      setGroups(toDraftGroups(saved.modifierGroups));
      if (next.priceIqd !== item.priceIqd) await actions.updatePrice.mutateAsync({ merchantOrgId: storeId, itemId: item.id, priceIqd: next.priceIqd });
      setTierEdit(null);
      toast.show({ message: t('merchant.tiers.saved'), tone: 'success' });
    } catch (err) {
      fail(err);
    } finally {
      setTierBusy(false);
    }
  };

  const chooseSoldBy = (v: 'one' | TierKind) => {
    if (v !== 'one') {
      setTierEdit(v);
      return;
    }
    if (!tiers) return;
    const cheapest = tiers.tiers[0]!.priceIqd;
    if (isNew || !item) {
      setGroups(dropTiers(groups));
      return;
    }
    saveGroups(dropTiers(groups), () => toast.show({ message: t('merchant.tiers.one_done', { price: amountParam(cheapest) }), tone: 'success' }));
  };

  if (!isNew && !item) {
    return (
      <Page title={t('merchant.item.title')} back testID="item-editor">
        {!menu.data ? (
          <LoadPending query={menu} skeleton={<Skeleton height={320} radius={theme.radius.xl} />} failed={t('merchant.menu.load_failed')} testID="item-editor" />
        ) : (
          <EmptyState icon="x" title={t('merchant.item.not_found')} action={{ label: t('merchant.item.back_to_menu'), onPress: () => router.replace('/menu') }} />
        )}
      </Page>
    );
  }

  const status = item ? itemStatus(item, Date.now()) : 'on';
  const photoUri = photo?.uri ?? (item?.photoUrl ? absoluteUrl(item.photoUrl) : null);

  // ── panels ──
  const photoPanel = (
    <Panel testID="photo-panel" padded={false} style={[{ overflow: 'hidden' }, forPhoto && !photoUri ? { borderWidth: 2, borderColor: theme.colors.accent } : null]}>
      <View style={{ aspectRatio: wide ? 4 / 3 : 16 / 9, backgroundColor: COUNTER.sand, alignItems: 'center', justifyContent: 'center' }}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[4] }}>
            {/* p2: until a photo arrives, the drawing customers see for this dish (from its name). */}
            <View style={{ width: wide ? 150 : 112, height: wide ? 150 : 112 }}>
              <DishArt name={form.nameAr || '·'} id={item?.id} section={form.categoryAr || null} />
            </View>
            <Text variant="footnote" color="text" align="center" style={{ maxWidth: 260 }}>
              {t('merchant.item.photo_drawing')}
            </Text>
          </View>
        )}
        {uploading ? (
          <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(color.neutral[900], 0.35) }}>
            <ActivityIndicator color={color.neutral[0]} />
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[3] }}>
        <Button testID="photo-library" size="sm" variant={photoUri ? 'secondary' : 'primary'} label={photoUri ? t('merchant.item.photo_replace') : t('merchant.item.photo_add')} trailing={<Glyph name="photo" size={18} strokeWidth={2} color={photoUri ? 'text' : 'onAccent'} />} onPress={() => void choosePhoto('library')} style={{ flex: 1 }} />
        {Platform.OS !== 'web' ? <Button size="sm" variant="secondary" label={t('merchant.item.photo_camera')} trailing={<Glyph name="camera" size={18} strokeWidth={2} />} onPress={() => void choosePhoto('camera')} style={{ flex: 1 }} /> : null}
      </View>
      {/* «من صورنا»: no time for a photo yet, take one of Driver's own until the shop's arrives. */}
      <View style={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[3], marginTop: -theme.space[1] }}>
        <Button testID="photo-from-library" size="sm" variant="ghost" label={t('merchant.library.open')} trailing={<Glyph name="sparkle" size={18} strokeWidth={2} />} onPress={() => setLibraryOpen(true)} />
      </View>
      {photoUri ? (
        <Text variant="caption" color="textMuted" style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[3] }}>
          {t('merchant.item.photo_tip')}
        </Text>
      ) : (
        // p1: the three things that make a dish photo sell, before the first one is taken.
        <View testID="photo-tips" style={{ gap: theme.space[1], paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>
          <Text variant="label" weight={700}>
            {t('merchant.item.photo_tips_title')}
          </Text>
          {(['photo_tip_light', 'photo_tip_middle', 'photo_tip_real'] as const).map((k) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.accent }} />
              <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
                {t(`merchant.item.${k}`)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Panel>
  );

  const soldByControl = (
    <View style={{ gap: theme.space[2] }} testID="sold-by">
      <Text variant="label">{t('merchant.tiers.sold_by')}</Text>
      <SegmentedControl
        options={[
          { value: 'one', label: t('merchant.tiers.one') },
          { value: 'weight', label: t('merchant.tiers.weight') },
          { value: 'size', label: t('merchant.tiers.size') },
        ]}
        value={soldBy}
        onChange={chooseSoldBy}
        accessibilityLabel={t('merchant.tiers.sold_by')}
      />
    </View>
  );

  const tierList = tiers ? (
    <View testID="tier-list" style={{ gap: theme.space[2] }}>
      {tiers.tiers.map((x) => (
        <View key={x.name} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {x.name}
          </Text>
          <Text variant="bodyStrong" tabular>
            {iqd(x.priceIqd, { locale })}
          </Text>
        </View>
      ))}
      <Button testID="tier-edit" size="sm" variant="secondary" label={t('merchant.tiers.edit')} onPress={() => setTierEdit(tiers.kind)} style={{ alignSelf: 'flex-start' }} />
    </View>
  ) : null;

  const pricePanel = item ? (
    <Panel testID="price-panel">
      <PanelTitle glyph="cash" title={t('merchant.item.price')} />
      {soldByControl}
      {tierList ?? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
          <Text variant="amount" tabular style={{ flex: 1 }}>
            {iqd(item.priceIqd, { locale })}
          </Text>
          <Button testID="price-edit" size="sm" label={t('merchant.item.price_change')} onPress={() => setPriceOpen(true)} />
        </View>
      )}
      <Pressable testID="price-history" accessibilityRole="button" onPress={() => setHistoryOpen(true)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], opacity: pressed ? 0.7 : 1 })}>
        <Glyph name="history" size={18} color="accentText" strokeWidth={2} />
        <Text variant="label" weight={600} color="accentText">
          {t('merchant.item.history_link')}
        </Text>
      </Pressable>
    </Panel>
  ) : null;

  const availabilityPanel = item ? (
    <Panel>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="title">{status === 'on' ? t('merchant.item.on_menu') : status === 'sold_out_today' ? t('merchant.item.sold_out_until') : t('merchant.item.hidden')}</Text>
          <Text variant="footnote" color="textMuted">
            {status === 'on' ? t('merchant.item.on_menu_hint') : status === 'sold_out_today' ? t('merchant.item.sold_out_hint') : t('merchant.item.hidden_hint')}
          </Text>
        </View>
        <Toggle
          testID="item-toggle"
          label={t('merchant.menu.toggle_label', { name: item.nameAr })}
          value={status === 'on'}
          onChange={(v) => storeId && actions.setAvailability.mutate({ merchantOrgId: storeId, itemId: item.id, available: v }, { onError: fail })}
        />
      </View>
      {status === 'on' ? (
        <Pill testID="item-sold-out" outline glyph="hourglass" label={t('merchant.menu.sold_out_today')} onPress={() => storeId && actions.soldOutToday.mutate({ merchantOrgId: storeId, itemId: item.id }, { onError: fail })} />
      ) : null}
    </Panel>
  ) : null;

  const basicsPanel = (
    <Panel>
      <PanelTitle glyph="pencil" title={t('merchant.item.basics')} />
      <TextField testID="item-name" label={t('merchant.item.name')} placeholder={t('merchant.item.name_placeholder')} value={form.nameAr} onChangeText={(v) => set('nameAr', v)} maxLength={80} error={tried && !nameOk ? t('merchant.item.name_missing') : undefined} />
      <TextField testID="item-description" label={t('merchant.item.description')} placeholder={t('merchant.item.description_placeholder')} value={form.description} onChangeText={(v) => set('description', v)} multiline maxLength={300} hint={t('merchant.item.description_hint')} />
      {isNew ? soldByControl : null}
      {isNew && tierList ? tierList : null}
      {isNew && !tierList ? (
        <TextField
          testID="item-price"
          label={t('merchant.item.price')}
          placeholder="3,000"
          value={form.price}
          onChangeText={(v) => set('price', v)}
          keyboardType="number-pad"
          trailing={
            <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[3] }}>
              {t('merchant.item.currency')}
            </Text>
          }
          error={tried && price === null ? t('merchant.item.price_invalid') : undefined}
          hint={price !== null && offStep(price) ? t('merchant.item.price_step_short') : undefined}
        />
      ) : null}
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label">{t('merchant.item.section')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {sections.map((s) => (
            <SectionOption key={s} label={s} selected={!newSection && form.categoryAr === s} onPress={() => {
              setNewSection(false);
              set('categoryAr', s);
            }} />
          ))}
          {form.categoryAr && !sections.includes(form.categoryAr) && !newSection ? <SectionOption label={form.categoryAr} selected onPress={() => setNewSection(true)} /> : null}
          <SectionOption testID="section-new" label={t('merchant.item.section_new')} glyph selected={newSection} onPress={() => {
            setNewSection(true);
            set('categoryAr', '');
          }} />
        </View>
        {newSection ? <TextField testID="item-section-new" placeholder={t('merchant.menu.section_placeholder')} value={form.categoryAr} onChangeText={(v) => set('categoryAr', v)} autoFocus maxLength={40} /> : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="label">{t('merchant.item.prep')}</Text>
          <Text variant="caption" color="textMuted">
            {t('merchant.item.prep_hint')}
          </Text>
        </View>
        <Stepper value={form.prepTimeMin} min={1} max={120} onChange={(n) => set('prepTimeMin', n)} accessibilityLabel={t('merchant.item.prep')} />
        <Text variant="label" color="textMuted" style={{ minWidth: 40 }}>
          {t('merchant.accept.minutes_unit')}
        </Text>
      </View>
      <View style={{ gap: theme.space[2] }} testID="item-labels">
        <View style={{ gap: 2 }}>
          <Text variant="label">{t('merchant.item.labels')}</Text>
          <Text variant="caption" color="textMuted">
            {t('merchant.item.labels_hint')}
          </Text>
        </View>
        <ChipGroup
          mode="multi"
          items={DISH_LABELS.map((l) => ({ id: l, label: t(`merchant.item.label_${l}`) }))}
          value={form.labels}
          onChange={(next) => set('labels', next.filter((l): l is DishLabel => (DISH_LABELS as readonly string[]).includes(l)))}
          accessibilityLabel={t('merchant.item.labels')}
        />
      </View>
      <TextField testID="item-name-en" label={t('merchant.item.name_en')} placeholder="Tikka wrap" value={form.nameEn} onChangeText={(v) => set('nameEn', v)} maxLength={80} autoCapitalize="words" />
    </Panel>
  );

  // The weight or size choice shows in the price panel, not twice.
  const extraGroups = tiers ? groups.filter((g) => g.nameAr.trim() !== TIER_GROUP[tiers.kind]) : groups;
  const groupsPanel = (
    <Panel testID="groups-panel">
      <PanelTitle glyph="sliders" title={t('merchant.item.options')} hint={t('merchant.item.options_hint')} />
      {extraGroups.length === 0 ? (
        <Text variant="body" color="textMuted">
          {t('merchant.item.options_none')}
        </Text>
      ) : (
        extraGroups.map((g, gi) => (
          <Pressable
            key={g.key}
            testID={`group-${gi}`}
            accessibilityRole="button"
            onPress={() => setGroupEdit({ group: g, isNew: false })}
            style={({ pressed }) => ({ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: theme.space[3], gap: theme.space[2], backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
                {g.nameAr}
              </Text>
              <Pill size="sm" tone={g.required ? 'accent' : 'neutral'} label={ruleText(t, g)} />
              <Glyph name="pencil" size={18} color="textMuted" />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {g.modifiers.map((m) => {
                const delta = parsePrice(m.price);
                return (
                  <View key={m.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surfaceSunken, opacity: m.available ? 1 : 0.5 }}>
                    <Text variant="caption" weight={600} style={m.available ? undefined : { textDecorationLine: 'line-through' }}>
                      {m.nameAr}
                    </Text>
                    {delta ? (
                      <Text variant="caption" color="textMuted" tabular>
                        {amountParam(delta, { sign: true })}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </Pressable>
        ))
      )}
      <Button
        testID="group-add"
        size="sm"
        variant="secondary"
        icon="plus"
        label={t('merchant.item.group_add')}
        onPress={() => setGroupEdit({ group: { key: draftKey('g'), nameAr: '', required: false, minSelect: 0, maxSelect: 1, modifiers: [{ key: draftKey('m'), nameAr: '', price: '0', available: true }] }, isNew: true })}
      />
    </Panel>
  );

  const saveBar = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
      {!isNew && dirty ? (
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('merchant.item.unsaved')}
        </Text>
      ) : (
        <View style={{ flex: 1 }} />
      )}
      <Button testID="item-save" label={isNew ? t('merchant.item.create') : t('merchant.item.save')} size="lg" disabled={!dirty} loading={saving} onPress={() => void saveBasics()} style={{ minWidth: wide ? 220 : undefined, flex: wide ? undefined : 1 }} />
    </View>
  );

  const title = isNew ? t('merchant.item.new_title') : (item?.nameAr ?? t('merchant.item.title'));
  const subtitle = isNew ? (form.categoryAr ? t('merchant.item.new_in', { section: form.categoryAr }) : undefined) : (item?.categoryAr ?? t('merchant.menu.no_section'));

  return (
    <Page title={title} subtitle={subtitle} back testID="item-editor" maxWidth={wide ? 1120 : 760}>
      {wide ? (
        <View style={{ flexDirection: 'row', gap: theme.space[5], alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: theme.space[5] }}>
            {basicsPanel}
            {groupsPanel}
            {saveBar}
          </View>
          <View style={{ width: 360, gap: theme.space[4] }}>
            {photoPanel}
            {pricePanel}
            {availabilityPanel}
          </View>
        </View>
      ) : (
        <>
          {photoPanel}
          {pricePanel}
          {availabilityPanel}
          {basicsPanel}
          {groupsPanel}
          {saveBar}
        </>
      )}
      {item ? (
        <>
          <PriceSheet visible={priceOpen} name={item.nameAr} current={item.priceIqd} busy={actions.updatePrice.isPending} onClose={() => setPriceOpen(false)} onSave={savePrice} />
          <HistorySheet visible={historyOpen} name={item.nameAr} history={history.data} loading={history.isLoading} onClose={() => setHistoryOpen(false)} />
        </>
      ) : null}
      <LibrarySheet visible={libraryOpen} name={form.nameAr} section={form.categoryAr || null} busy={uploading} onClose={() => setLibraryOpen(false)} onPick={(src) => void pickFromLibrary(src)} />
      <TierSheet
        visible={tierEdit !== null}
        kind={tierEdit ?? 'weight'}
        name={form.nameAr || t('merchant.item.new_title')}
        initial={tiers && tierEdit === tiers.kind ? tiers.tiers : null}
        busy={tierBusy}
        onClose={() => setTierEdit(null)}
        onSave={(list) => tierEdit && void saveTiers(tierEdit, list)}
      />
      <GroupSheet
        visible={groupEdit !== null}
        group={groupEdit?.group ?? null}
        isNew={groupEdit?.isNew ?? true}
        busy={actions.setModifiers.isPending}
        onClose={() => setGroupEdit(null)}
        onSave={(g) => saveGroups(groupEdit?.isNew ? [...groups, g] : groups.map((x) => (x.key === g.key ? g : x)), () => setGroupEdit(null))}
        onDelete={() => groupEdit && saveGroups(groups.filter((x) => x.key !== groupEdit.group.key), () => setGroupEdit(null))}
      />
    </Page>
  );
}

function SectionOption({ label, selected, onPress, glyph, testID }: { label: string; selected: boolean; onPress: () => void; glyph?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable hitSlop={2}
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 40,
        paddingHorizontal: theme.space[4],
        borderRadius: theme.radius.pill,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        borderStyle: glyph && !selected ? 'dashed' : 'solid',
        backgroundColor: selected ? theme.colors.accentTint : theme.colors.surface,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {glyph ? <Glyph name="plus" size={16} color="accentText" strokeWidth={2} /> : null}
      <Text variant="label" weight={selected ? 700 : 500} color={selected || glyph ? 'accentText' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}
