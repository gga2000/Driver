import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { AdminMenuItem } from '@driver/contracts';
import { Icon, IconButton, Text, TextField, useTheme } from '@driver/ui';
import { absoluteUrl, pickPhotos, type PickedPhoto, type PhotoSource } from '@/features/menu/photo';
import { useMenuActions, usePhotoUpload } from '@/features/menu/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT, type TKey } from '@/lib/i18n';
import { groupDigits } from '@/lib/money';
import { useCounterToast } from '@/lib/toast';
import { draftOf, draftProblems, emptyDraft, emptyRow, toSave, type CartDraft, type DraftRow } from './item';

/** One tap fills a usual price. */
const QUICK_PRICES = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
/** Extras most carts have; one tap adds the row, he fixes the price. */
const EXTRA_IDEAS: TKey[] = ['merchant.cart.extra_idea_egg', 'merchant.cart.extra_idea_hot', 'merchant.cart.extra_idea_onion', 'merchant.cart.extra_idea_bread'];

/**
 * «شي جديد» / editing a dish, the cart's own way (Ali 2026-10-12: the restaurant editor was terrible for
 * a cart; "full freedom of what he can add"). No library, no sections, no kitchen settings: a photo if
 * he wants, any name, a price (or sizes, each with its full price), extras with what they add, and one
 * line about it. Saving puts it on the cart for tonight.
 */
export function CartItemEditor({ storeId, item }: { storeId: string; item: AdminMenuItem | null }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useCounterToast();
  const actions = useMenuActions(storeId);
  const upload = usePhotoUpload();
  const c = theme.services.carts;

  const [d, setD] = useState<CartDraft>(() => (item ? draftOf(item) : emptyDraft()));
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const problems = tried ? draftProblems(d) : [];
  const set = (patch: Partial<CartDraft>) => setD((x) => ({ ...x, ...patch }));
  const photoUri = photo?.uri ?? (item?.photoUrl ? absoluteUrl(item.photoUrl) : null);
  const hasSizes = d.sizes.length > 0;

  const pick = async (source: PhotoSource) => {
    const picked = await pickPhotos(source, { square: true });
    if (picked === 'denied') return toast.show({ tone: 'warning', message: t('merchant.item.photo_denied') });
    if (picked?.[0]) setPhoto(picked[0]);
  };

  const save = async () => {
    setTried(true);
    if (draftProblems(d).length > 0) return;
    const out = toSave(d, { sizes: t('merchant.cart.group_sizes'), extras: t('merchant.cart.group_extras') }, item ?? undefined);
    setSaving(true);
    try {
      const saved = await actions.upsertItem.mutateAsync({ merchantOrgId: storeId, ...(item ? { itemId: item.id } : { available: true }), nameAr: out.nameAr, description: out.description, priceIqd: out.priceIqd });
      // Always written, so removing every size or extra clears them too.
      if (out.groups.length > 0 || (item?.modifierGroups.length ?? 0) > 0) await actions.setModifiers.mutateAsync({ merchantOrgId: storeId, itemId: saved.id, groups: out.groups });
      if (photo) await actions.replacePhoto.mutateAsync({ merchantOrgId: storeId, itemId: saved.id, uploadId: await upload(photo) });
      toast.show({ tone: 'success', icon: 'check', message: t(item ? 'merchant.cart.item_saved' : 'merchant.cart.item_added', { name: out.nameAr }) });
      router.back();
    } catch (e) {
      toast.show({ tone: 'danger', message: apiErrorMessage(e, t('merchant.cart.failed'), locale) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: theme.space[6] }} testID="cart-item">
      <View style={{ flexDirection: 'row', gap: theme.space[4], alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('merchant.cart.photo_take')}
          onPress={() => void pick('camera')}
          testID="cart-item-photo"
          style={({ pressed }) => ({ width: 120, height: 120, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', gap: theme.space[1], opacity: pressed ? 0.85 : 1 })}
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityIgnoresInvertColors />
          ) : (
            <>
              <Icon name="camera" size={30} color={theme.colors.text} />
              <Text variant="footnote" weight={600}>
                {t('merchant.cart.photo_take')}
              </Text>
            </>
          )}
        </Pressable>
        <View style={{ flex: 1, gap: theme.space[2] }}>
          <Text variant="body" color="textMuted">
            {photoUri ? t('merchant.cart.photo_have') : t('merchant.cart.photo_why')}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => void pick('library')} testID="cart-item-library" style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text variant="body" weight={600} color="accentText">
              {t('merchant.cart.photo_library')}
            </Text>
          </Pressable>
        </View>
      </View>

      <TextField
        label={t('merchant.cart.item_name')}
        placeholder={t('merchant.cart.item_name_hint')}
        value={d.name}
        onChangeText={(name) => set({ name })}
        maxLength={80}
        error={problems.includes('name') ? t('merchant.cart.item_name_missing') : undefined}
        testID="cart-item-name"
      />

      {!hasSizes ? (
        <View style={{ gap: theme.space[3] }}>
          <TextField
            label={t('merchant.cart.item_price')}
            placeholder="2,000"
            value={d.price}
            onChangeText={(price) => set({ price })}
            keyboardType="number-pad"
            trailing={<Text color="textMuted">{t('merchant.cart.dinar')}</Text>}
            error={problems.includes('price') ? t('merchant.cart.item_price_missing') : undefined}
            testID="cart-item-price"
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            {QUICK_PRICES.map((p) => {
              const selected = d.price === String(p);
              return (
                <Pressable
                  key={p}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => set({ price: String(p) })}
                  testID={`cart-item-quick-${p}`}
                  style={({ pressed }) => ({ minHeight: 40, minWidth: 64, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: selected ? 0 : 1, borderColor: theme.colors.border, backgroundColor: selected ? c.fill : pressed ? theme.colors.surfaceSunken : theme.colors.surface })}
                >
                  <Text variant="label" tabular weight={selected ? 700 : 500} style={selected ? { color: c.on } : undefined}>
                    {groupDigits(p)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <Section title={t('merchant.cart.sizes_title')} sub={t('merchant.cart.sizes_sub')}>
        {d.sizes.map((r, i) => (
          <Row
            key={r.key}
            row={r}
            namePlaceholder={t(i === 0 ? 'merchant.cart.size_name_hint_1' : 'merchant.cart.size_name_hint_2')}
            pricePlaceholder={i === 0 ? '1,500' : '2,500'}
            plus={false}
            bad={problems.includes('size_row') && (!r.name.trim() || !r.price.trim())}
            onChange={(next) => set({ sizes: d.sizes.map((x) => (x.key === r.key ? next : x)) })}
            onRemove={() => set({ sizes: d.sizes.length <= 2 ? [] : d.sizes.filter((x) => x.key !== r.key) })}
            testID={`cart-size-${i}`}
          />
        ))}
        {problems.includes('sizes') ? (
          <Text variant="footnote" color="danger">
            {t('merchant.cart.sizes_two')}
          </Text>
        ) : null}
        <AddButton
          label={t(hasSizes ? 'merchant.cart.size_add' : 'merchant.cart.sizes_start')}
          onPress={() => set(hasSizes ? { sizes: [...d.sizes, emptyRow()] } : { sizes: [{ ...emptyRow(), price: d.price }, emptyRow()] })}
          testID="cart-size-add"
        />
      </Section>

      <Section title={t('merchant.cart.extras_title')} sub={t('merchant.cart.extras_sub')}>
        {d.extras.map((r, i) => (
          <Row
            key={r.key}
            row={r}
            namePlaceholder={t('merchant.cart.extra_name_hint')}
            pricePlaceholder="0"
            plus
            bad={problems.includes('extra_row') && !r.name.trim()}
            onChange={(next) => set({ extras: d.extras.map((x) => (x.key === r.key ? next : x)) })}
            onRemove={() => set({ extras: d.extras.filter((x) => x.key !== r.key) })}
            testID={`cart-extra-${i}`}
          />
        ))}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {EXTRA_IDEAS.filter((k) => !d.extras.some((e) => e.name === t(k))).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="button"
              onPress={() => set({ extras: [...d.extras, { ...emptyRow(), name: t(k) }] })}
              testID={`cart-extra-idea-${k.split('_').pop()}`}
              style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: theme.space[3], borderRadius: theme.radius.pill, flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: theme.colors.border, borderStyle: 'dashed', backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface })}
            >
              <Icon name="plus" size={16} color={theme.colors.text} />
              <Text variant="label">{t(k)}</Text>
            </Pressable>
          ))}
        </View>
        <AddButton label={t('merchant.cart.extra_add')} onPress={() => set({ extras: [...d.extras, emptyRow()] })} testID="cart-extra-add" />
      </Section>

      <TextField
        label={t('merchant.cart.item_about')}
        placeholder={t('merchant.cart.item_about_hint')}
        value={d.about}
        onChangeText={(about) => set({ about })}
        maxLength={300}
        multiline
        testID="cart-item-about"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy: saving, disabled: saving }}
        disabled={saving}
        onPress={() => void save()}
        testID="cart-item-save"
        style={({ pressed }) => ({ minHeight: 64, borderRadius: 32, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.88 : 1 })}
      >
        {saving ? (
          <ActivityIndicator color={c.on} />
        ) : (
          <Text variant="title" face="display" style={{ color: c.on }}>
            {t(item ? 'merchant.cart.item_save' : 'merchant.cart.item_add')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading" face="display">
          {title}
        </Text>
        <Text variant="footnote" color="textMuted">
          {sub}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** A size («نص» · 1,500) or an extra («بيض» · +500): name, price, and a cross. */
function Row({ row, namePlaceholder, pricePlaceholder, plus, bad, onChange, onRemove, testID }: { row: DraftRow; namePlaceholder: string; pricePlaceholder: string; plus: boolean; bad: boolean; onChange: (r: DraftRow) => void; onRemove: () => void; testID: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID={testID}>
      <View style={{ flex: 3 }}>
        <TextField placeholder={namePlaceholder} value={row.name} onChangeText={(name) => onChange({ ...row, name })} maxLength={60} error={bad && !row.name.trim() ? ' ' : undefined} accessibilityLabel={namePlaceholder} testID={`${testID}-name`} />
      </View>
      <View style={{ flex: 2 }}>
        <TextField
          placeholder={pricePlaceholder}
          value={row.price}
          onChangeText={(price) => onChange({ ...row, price })}
          keyboardType="number-pad"
          trailing={plus ? <Text color="textMuted">+</Text> : undefined}
          error={bad && !plus && !row.price.trim() ? ' ' : undefined}
          accessibilityLabel={t(plus ? 'merchant.cart.extra_price' : 'merchant.cart.size_price')}
          testID={`${testID}-price`}
        />
      </View>
      <IconButton icon="x" accessibilityLabel={t('merchant.cart.row_remove')} onPress={onRemove} testID={`${testID}-remove`} />
    </View>
  );
}

function AddButton({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} testID={testID} style={({ pressed }) => ({ minHeight: 48, borderRadius: theme.radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], opacity: pressed ? 0.8 : 1 })}>
      <Icon name="plus" size={18} color={theme.colors.text} />
      <Text variant="body" weight={600}>
        {label}
      </Text>
    </Pressable>
  );
}
