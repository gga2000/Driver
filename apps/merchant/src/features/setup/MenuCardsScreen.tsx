import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { MenuCard, MenuCards } from '@driver/contracts';
import { Button, ModalSheet, PhotoImage, Skeleton, Text, TextField, useTheme, withAlpha } from '@driver/ui';
import { Loadable } from '@/components/Loadable';
import { MIcon } from '@/components/MIcon';
import { Page } from '@/components/Page';
import { LIBRARY, type LibraryDish } from '@/features/menu/library-data';
import { libraryMatches } from '@/features/menu/library';
import { libraryPhoto, LibrarySheet } from '@/features/menu/LibrarySheet';
import { parsePrice } from '@/features/menu/logic';
import { absoluteUrl, pickPhotos, type PickedPhoto } from '@/features/menu/photo';
import { usePhotoUpload } from '@/features/menu/queries';
import { useCurrentStore } from '@/features/store/queries';
import { apiErrorMessage } from '@/lib/api';
import { COUNTER } from '@/lib/counter';
import { useLocale, useT } from '@/lib/i18n';
import { useLayout } from '@/lib/layout';
import { iqd } from '@/lib/money';
import { useCounterToast } from '@/lib/toast';
import { bestLibraryDish, doorsOf, voiceOf, type SetupVoice } from './logic';
import { useMenuCards, useSetup, useSetupActions } from './queries';
import { SetupBar } from './SetupRing';

/** The photo kept for a card: one of Driver's library photos (marked «صورة توضيحية»), his own, or none. */
type CardPhoto = { kind: 'library'; slug: string; src: number | string } | { kind: 'own'; photo: PickedPhoto } | null;

function libraryChoice(dish: LibraryDish | null): CardPhoto {
  const src = dish?.photos[0];
  return dish && src !== undefined ? { kind: 'library', slug: dish.slug, src } : null;
}

/**
 * The menu, done for him (m1, m2, m3, m6): he photographs the menu on the wall (or field ops did on the
 * visit), Driver writes the dishes, and each comes back as a card — the closest library photo, the
 * name, the price. «صح» puts it on the menu, «عدّل» fixes it in place, «مو هذا» leaves it out. Nothing
 * reaches customers before «صح».
 */
export function MenuCardsScreen() {
  const theme = useTheme();
  const t = useT();
  const { store } = useCurrentStore();
  const storeId = store?.orgId ?? null;
  const cards = useMenuCards(storeId);
  const setup = useSetup(storeId);
  const voice = setup.data ? voiceOf(doorsOf(setup.data)) : 'food';
  const items = setup.data?.menu.items ?? 0;
  const pending = cards.data?.cards.filter((c) => c.answer === 'pending').length ?? 0;
  const total = cards.data?.cards.length ?? 0;
  return (
    <Page
      title={cards.data?.state === 'ready' ? t(voice === 'drinks' ? 'merchant.setup.cards_title_drinks' : 'merchant.setup.cards_title') : t('merchant.setup.step_menu')}
      back
      testID="setup-menu"
      maxWidth={640}
      aside={
        cards.data?.state === 'ready' ? (
          <Text variant="label" weight={700} tabular style={{ color: COUNTER.newBadge }}>
            {t('merchant.setup.done_of', { done: total - pending, total })}
          </Text>
        ) : undefined
      }
    >
      <Loadable query={cards} stale={false} skeleton={<Skeleton height={420} radius={theme.radius.xl} />} failed={t('merchant.setup.cards_failed')} testID="setup-cards">
        {(c) =>
          c.state === 'ready' ? (
            <CardStack cards={c} voice={voice} />
          ) : c.state === 'reading' ? (
            <Reading cards={c} />
          ) : c.state === 'done' ? (
            <Done count={c.cards.filter((x) => x.answer === 'ok').length || items} voice={voice} />
          ) : (
            <ShootMenu merchantOrgId={c.merchantOrgId} items={items} voice={voice} />
          )
        }
      </Loadable>
    </Page>
  );
}

/** m1: photograph the menu — the wall board, the paper menu, or old photos. */
function ShootMenu({ merchantOrgId, items, voice }: { merchantOrgId: string; items: number; voice: SetupVoice }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const upload = usePhotoUpload();
  const { startMenu } = useSetupActions();
  const [picked, setPicked] = useState<PickedPhoto[]>([]);
  const [sending, setSending] = useState<{ done: number; total: number } | null>(null);
  const add = async (source: 'camera' | 'library') => {
    const res = await pickPhotos(source, { multiple: true });
    if (res === 'denied') return toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
    if (res) setPicked((p) => [...p, ...res].slice(0, 10));
  };
  const send = async () => {
    setSending({ done: 0, total: picked.length });
    try {
      const ids: string[] = [];
      for (const p of picked) {
        ids.push(await upload(p));
        setSending({ done: ids.length, total: picked.length });
      }
      await startMenu.mutateAsync({ merchantOrgId, uploadIds: ids });
      setPicked([]);
      toast.show({ message: t('merchant.setup.menu_sent'), tone: 'success', icon: 'check' });
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    } finally {
      setSending(null);
    }
  };
  return (
    <View style={{ gap: theme.space[4] }}>
      {items > 0 ? (
        <View testID="setup-menu-has" style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.successTint }}>
          <MIcon name="check" size={18} color="successText" strokeWidth={2.4} />
          <Text variant="footnote" weight={600} color="successText" style={{ flex: 1 }}>
            {t('merchant.setup.menu_has', { what: t(voice === 'drinks' ? 'merchant.setup.count_drinks' : 'merchant.setup.count_dishes', { count: items }) })}
          </Text>
        </View>
      ) : null}
      <View testID="setup-shoot" style={{ backgroundColor: COUNTER.date, borderRadius: theme.radius['2xl'], padding: theme.space[5], gap: theme.space[4] }}>
        <View style={{ gap: theme.space[1] }}>
          <Text style={[theme.face('display'), { color: COUNTER.onDate, fontSize: 24, lineHeight: 36 }]}>{t('merchant.setup.shoot_title')}</Text>
          <Text variant="body" style={{ color: COUNTER.onDateMuted }}>
            {t('merchant.setup.shoot_body')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {picked.map((p, i) => (
            <View key={`${p.uri}-${i}`} style={{ width: 92, aspectRatio: 3 / 4, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: COUNTER.dateRaised }}>
              <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            </View>
          ))}
          {picked.length < 10 && !sending ? (
            <Pressable
              testID="setup-shoot-pick"
              accessibilityRole="button"
              onPress={() => void add('library')}
              style={({ pressed }) => ({ width: picked.length ? 92 : '100%', minHeight: 122, aspectRatio: picked.length ? 3 / 4 : undefined, borderRadius: theme.radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: COUNTER.saffron, alignItems: 'center', justifyContent: 'center', gap: theme.space[2], padding: theme.space[3], opacity: pressed ? 0.8 : 1 })}
            >
              <MIcon name="camera" size={28} color={COUNTER.saffron} />
              <Text variant="label" weight={700} align="center" style={{ color: COUNTER.onDate }}>
                {picked.length ? t('merchant.setup.shoot_more') : t('merchant.setup.shoot_pick')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {Platform.OS !== 'web' && !sending ? <Button label={t('merchant.item.photo_camera')} icon="camera" variant="secondary" onPress={() => void add('camera')} /> : null}
        <Button
          testID="setup-shoot-send"
          label={picked.length ? t('merchant.setup.shoot_send', { count: picked.length }) : t('merchant.setup.shoot_send_empty')}
          size="lg"
          fullWidth
          disabled={picked.length === 0}
          loading={sending !== null}
          loadingLabel={sending ? t('merchant.import.uploading', { done: sending.done, total: sending.total }) : undefined}
          onPress={() => void send()}
        />
      </View>
      <Text variant="footnote" color="textMuted" align="center">
        {t('merchant.setup.shoot_note')}
      </Text>
    </View>
  );
}

/** Photos in, the dishes being written: he can wait, or type them himself (the import table, as cards). */
function Reading({ cards }: { cards: MenuCards }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="setup-reading" style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {cards.photoUrls.map((u, i) => (
          <View key={`${u}-${i}`} style={{ width: 96, aspectRatio: 3 / 4, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: COUNTER.sand }}>
            <PhotoImage uri={absoluteUrl(u)} style={{ width: '100%', height: '100%' }} />
          </View>
        ))}
      </View>
      <View style={{ gap: theme.space[2], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: COUNTER.laneNew }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <MIcon name="hourglass" size={20} color={COUNTER.newBadge} />
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {t('merchant.setup.reading_title')}
          </Text>
        </View>
        <Text variant="body" color="textMuted">
          {t('merchant.setup.reading_body')}
        </Text>
      </View>
      <Button testID="setup-type-myself" label={t('merchant.setup.type_myself')} icon="plus" variant="secondary" size="lg" fullWidth onPress={() => router.push({ pathname: '/menu/import', params: { setup: '1', job: cards.jobId ?? '' } })} />
      <Button label={t('merchant.setup.back_to_list')} variant="ghost" size="lg" fullWidth onPress={() => router.navigate('/setup')} />
    </View>
  );
}

function Done({ count, voice }: { count: number; voice: SetupVoice }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View testID="setup-menu-done" style={{ alignItems: 'center', gap: theme.space[4], paddingVertical: theme.space[8] }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: COUNTER.ready, alignItems: 'center', justifyContent: 'center' }}>
        <MIcon name="check" size={40} color={COUNTER.onDate} strokeWidth={2.6} />
      </View>
      <Text variant="heading" align="center">
        {t('merchant.setup.menu_done_title')}
      </Text>
      <Text variant="body" color="textMuted" align="center">
        {t('merchant.setup.menu_done_body', { what: t(voice === 'drinks' ? 'merchant.setup.count_drinks' : 'merchant.setup.count_dishes', { count }) })}
      </Text>
      <Button testID="setup-menu-back" label={t('merchant.setup.back_to_list')} size="lg" onPress={() => router.navigate('/setup')} />
    </View>
  );
}

/** m2: one card at a time, the rest stacked behind it. */
function CardStack({ cards, voice }: { cards: MenuCards; voice: SetupVoice }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const upload = usePhotoUpload();
  const { answer } = useSetupActions();
  const { wide } = useLayout();
  const pending = cards.cards.filter((c) => c.answer === 'pending');
  const card = pending[0] ?? null;
  const total = cards.cards.length;
  const best = useMemo(() => (card ? bestLibraryDish(LIBRARY, card.nameAr, card.categoryAr) : null), [card]);
  const [photo, setPhoto] = useState<CardPhoto>(libraryChoice(best));
  const [fixing, setFixing] = useState(false);
  const [busy, setBusy] = useState<'ok' | 'skip' | null>(null);
  useEffect(() => setPhoto(libraryChoice(best)), [card?.index, best]);
  if (!card || !cards.jobId) return null;
  const jobId = cards.jobId;

  const send = async (kind: 'ok' | 'skip', fix?: { nameAr: string; priceIqd: number; categoryAr: string | null; photo: CardPhoto }) => {
    setBusy(kind);
    try {
      const keep = fix ? fix.photo : photo;
      let uploadId: string | undefined;
      let librarySlug: string | undefined;
      if (kind === 'ok' && keep) {
        uploadId = await upload(keep.kind === 'library' ? await libraryPhoto(keep.src) : keep.photo);
        if (keep.kind === 'library') librarySlug = keep.slug;
      }
      await answer.mutateAsync({
        merchantOrgId: cards.merchantOrgId,
        jobId,
        index: card.index,
        answer: kind,
        ...(fix ? { nameAr: fix.nameAr, priceIqd: fix.priceIqd, categoryAr: fix.categoryAr } : {}),
        ...(uploadId ? { uploadId } : {}),
        ...(librarySlug ? { librarySlug } : {}),
      });
      setFixing(false);
      if (kind === 'ok') theme.haptic('success');
    } catch (err) {
      toast.show({ message: apiErrorMessage(err, t('merchant.common.error'), locale), tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: theme.space[4] }}>
      <SetupBar percent={Math.round(((total - pending.length) / Math.max(1, total)) * 100)} />
      <View>
        {/* The cards still to come, peeking from behind. */}
        {pending.length > 2 ? <View style={{ position: 'absolute', top: 14, start: 14, end: 14, bottom: -14, borderRadius: theme.radius['2xl'], backgroundColor: COUNTER.sand }} /> : null}
        {pending.length > 1 ? <View style={{ position: 'absolute', top: 7, start: 7, end: 7, bottom: -7, borderRadius: theme.radius['2xl'], backgroundColor: COUNTER.laneCooking }} /> : null}
        <DishCard card={card} photo={photo} voice={voice} wide={wide} />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[3], marginTop: theme.space[2] }}>
        <Pressable
          testID="setup-card-ok"
          accessibilityRole="button"
          accessibilityLabel={t('merchant.setup.yes')}
          disabled={busy !== null}
          onPress={() => void send('ok')}
          style={({ pressed }) => ({ flex: 1.4, minHeight: 60, borderRadius: theme.radius.xl, backgroundColor: COUNTER.ready, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: theme.space[2], opacity: busy !== null ? 0.6 : pressed ? 0.85 : 1 })}
        >
          <MIcon name="check" size={22} color={COUNTER.onDate} strokeWidth={2.6} />
          <Text weight={700} style={{ color: COUNTER.onDate, fontSize: 19, lineHeight: 28 }}>
            {busy === 'ok' ? t('merchant.setup.saving') : t('merchant.setup.yes')}
          </Text>
        </Pressable>
        <Button testID="setup-card-fix" label={t('merchant.setup.fix')} variant="secondary" size="lg" disabled={busy !== null} onPress={() => setFixing(true)} style={{ flex: 1 }} />
      </View>
      <Button testID="setup-card-skip" label={t('merchant.setup.not_this')} variant="ghost" size="md" loading={busy === 'skip'} disabled={busy !== null} onPress={() => void send('skip')} />
      <Text variant="footnote" color="textMuted" align="center">
        {t('merchant.setup.cards_note')}
      </Text>
      <FixSheet visible={fixing} card={card} photo={photo} busy={busy === 'ok'} onClose={() => setFixing(false)} onSave={(fix) => void send('ok', fix)} />
    </View>
  );
}

function DishCard({ card, photo, voice, wide }: { card: MenuCard; photo: CardPhoto; voice: SetupVoice; wide: boolean }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  return (
    <View testID={`setup-card-${card.index}`} style={{ backgroundColor: COUNTER.paper, borderRadius: theme.radius['2xl'], overflow: 'hidden', borderWidth: 1, borderColor: theme.colors.border, shadowColor: COUNTER.date, shadowOpacity: 0.12, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 }}>
      <View style={{ aspectRatio: wide ? 16 / 9 : 4 / 3, backgroundColor: COUNTER.sand, alignItems: 'center', justifyContent: 'center' }}>
        {photo ? (
          <Image source={photo.kind === 'library' ? photo.src : { uri: photo.photo.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        ) : (
          <View style={{ alignItems: 'center', gap: theme.space[2] }}>
            <MIcon name="camera" size={34} color={COUNTER.date} />
            <Text variant="label" weight={600} style={{ color: COUNTER.date }}>
              {t('merchant.setup.card_no_photo')}
            </Text>
          </View>
        )}
      </View>
      <View style={{ padding: theme.space[4], gap: theme.space[2] }}>
        {photo?.kind === 'library' ? (
          <View testID="setup-card-library" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: theme.space[3], borderRadius: 14, backgroundColor: theme.colors.successTint }}>
            <MIcon name="camera" size={14} color="successText" />
            <Text variant="caption" weight={700} color="successText">
              {t('merchant.setup.library_badge')}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[3] }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[theme.face('display'), { color: COUNTER.date, fontSize: 26, lineHeight: 40 }]}>{card.nameAr}</Text>
            {card.categoryAr ? (
              <Text variant="footnote" color="textMuted">
                {card.categoryAr}
              </Text>
            ) : null}
          </View>
          <Text weight={700} tabular style={[theme.face('display'), { color: COUNTER.date, fontSize: 22, lineHeight: 34 }]}>
            {iqd(card.priceIqd, { locale })}
          </Text>
        </View>
        {photo?.kind === 'library' ? (
          <Text variant="caption" color="textMuted">
            {t(voice === 'drinks' ? 'merchant.setup.library_note_drinks' : 'merchant.setup.library_note')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** «عدّل»: the name, price and section in place, and the photo — another library one, or his own. */
function FixSheet({ visible, card, photo, busy, onClose, onSave }: { visible: boolean; card: MenuCard; photo: CardPhoto; busy: boolean; onClose: () => void; onSave: (fix: { nameAr: string; priceIqd: number; categoryAr: string | null; photo: CardPhoto }) => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useCounterToast();
  const [name, setName] = useState(card.nameAr);
  const [price, setPrice] = useState(String(card.priceIqd));
  const [section, setSection] = useState(card.categoryAr ?? '');
  const [pick, setPick] = useState<CardPhoto>(photo);
  const [library, setLibrary] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setName(card.nameAr);
    setPrice(String(card.priceIqd));
    setSection(card.categoryAr ?? '');
    setPick(photo);
  }, [visible, card, photo]);
  const matches = useMemo(() => libraryMatches(LIBRARY, name, section).slice(0, 2), [name, section]);
  const choices = matches.flatMap((d) => d.photos.map((src) => ({ slug: d.slug, src }))).slice(0, 4);
  const parsed = parsePrice(price);
  const own = async () => {
    const res = await pickPhotos('library');
    if (res === 'denied') return toast.show({ message: t('merchant.item.photo_denied'), tone: 'warning' });
    if (res?.[0]) setPick({ kind: 'own', photo: res[0] });
  };
  const tile = (selected: boolean) => ({ width: 84, height: 68, borderRadius: theme.radius.md, overflow: 'hidden' as const, borderWidth: 3, borderColor: selected ? COUNTER.date : 'transparent', backgroundColor: COUNTER.sand });
  return (
    <>
      <ModalSheet
        visible={visible && !library}
        onClose={onClose}
        locked={busy}
        title={t('merchant.setup.fix_title')}
        testID="setup-fix"
        footer={<Button testID="setup-fix-save" label={t('merchant.setup.fix_save')} icon="check" size="lg" fullWidth loading={busy} disabled={!name.trim() || parsed === null} onPress={() => parsed !== null && onSave({ nameAr: name.trim(), priceIqd: parsed, categoryAr: section.trim() || null, photo: pick })} />}
      >
        <View style={{ gap: theme.space[3] }}>
          <TextField testID="setup-fix-name" label={t('merchant.setup.fix_name')} value={name} onChangeText={setName} maxLength={80} />
          <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
            <TextField testID="setup-fix-price" label={t('merchant.setup.fix_price')} value={price} onChangeText={setPrice} keyboardType="number-pad" style={{ flex: 1 }} error={parsed === null ? t('merchant.import.err_price') : undefined} />
            <TextField testID="setup-fix-section" label={t('merchant.setup.fix_section')} value={section} onChangeText={setSection} maxLength={40} style={{ flex: 1 }} />
          </View>
          <Text variant="label" weight={700}>
            {t('merchant.setup.fix_photo')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {choices.map((c, i) => (
              <Pressable key={`${c.slug}-${i}`} accessibilityRole="radio" accessibilityState={{ checked: pick?.kind === 'library' && pick.src === c.src }} accessibilityLabel={t('merchant.library.photo_label', { name: name, n: i + 1 })} onPress={() => setPick({ kind: 'library', slug: c.slug, src: c.src })} style={tile(pick?.kind === 'library' && pick.src === c.src)}>
                <Image source={c.src} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </Pressable>
            ))}
            {pick?.kind === 'own' ? (
              <View style={tile(true)}>
                <Image source={{ uri: pick.photo.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </View>
            ) : null}
            <Pressable testID="setup-fix-own" accessibilityRole="button" onPress={() => void own()} style={{ ...tile(false), alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: COUNTER.saffron, backgroundColor: withAlpha(COUNTER.saffron, 0.08) }}>
              <MIcon name="camera" size={20} color={COUNTER.newBadge} />
              <Text variant="caption" weight={700} style={{ color: COUNTER.newBadge }}>
                {t('merchant.setup.fix_own')}
              </Text>
            </Pressable>
            <Pressable testID="setup-fix-library" accessibilityRole="button" onPress={() => setLibrary(true)} style={{ ...tile(false), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border }}>
              <MIcon name="grid" size={20} color={COUNTER.date} />
              <Text variant="caption" weight={700} style={{ color: COUNTER.date }}>
                {t('merchant.setup.fix_more')}
              </Text>
            </Pressable>
          </View>
          <Text variant="caption" color="textMuted">
            {t('merchant.setup.fix_photo_note')}
          </Text>
        </View>
      </ModalSheet>
      <LibrarySheet
        visible={visible && library}
        name={name}
        section={section || null}
        busy={false}
        onClose={() => setLibrary(false)}
        onPick={(src) => {
          const dish = LIBRARY.find((d) => d.photos.includes(src));
          if (dish) setPick({ kind: 'library', slug: dish.slug, src });
          setLibrary(false);
        }}
      />
    </>
  );
}
