import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Button, Icon, IconButton, Stepper, Text, TextField, useTheme, useToast, type IconName } from '@driver/ui';
import type { MessageKey } from '@driver/i18n';
import { Screen } from '@/components/Screen';
import { pickGatePhoto } from '@/features/account/device';
import { useT } from '@/lib/i18n';
import { blankItem, ERRAND_UNITS, errandDraft, IF_MISSING, itemReady, shopPin, type ErrandItem, type ErrandWhere } from '@/features/shopping/errand';
import { GreenBar } from '@/features/shopping/GreenBar';
import { useShopping } from '@/features/shopping/palette';
import { ProducePhoto } from '@/features/shopping/ProducePhoto';
import { useAppShops } from '@/features/shopping/queries';
import { ShopHeader } from '@/features/shopping/ShopHeader';
import { ITEM_VOICE_MAX_MS, useItemVoice } from '@/features/shopping/useItemVoice';

/**
 * One دوّرلي item (round 2 «غرض جديد», Ali 2026-10-11: "the customer would type an item, from which
 * shop if he has a shop in mind, quantity, etc."): what (words, a voice note, a photo of the old one),
 * how much and in what unit, from where (any shop nearby, a shop in the app, a shop he knows, marked
 * on the map), what to do if it isn't there, and the most he'll pay. `?start=voice|photo` opens with
 * the recorder or the camera, from the list's buttons.
 */
export default function ErrandItemScreen() {
  const { id, start } = useLocalSearchParams<{ id?: string; start?: 'voice' | 'photo' }>();
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const toast = useToast();
  const voice = useItemVoice();
  const existing = id ? errandDraft.get().items.find((i) => i.id === id) : undefined;
  const [item, setItem] = useState<ErrandItem>(() => existing ?? blankItem());
  const [shopSearch, setShopSearch] = useState('');
  const shops = useAppShops(shopSearch);
  const started = useRef(false);
  const patch = (p: Partial<ErrandItem>) => setItem((cur) => ({ ...cur, ...p }));

  const takePhoto = async () => {
    const res = await pickGatePhoto('camera');
    if (res === 'denied') toast.show({ message: t('shopping.camera_denied'), tone: 'warning' });
    else if (res) patch({ photoUri: res.uri });
  };
  const toggleRecord = async () => {
    if (voice.recording) {
      const clip = await voice.stop();
      if (clip) patch({ voice: clip });
      return;
    }
    const ok = await voice.start();
    if (!ok) toast.show({ message: t('shopping.mic_denied'), tone: 'warning', icon: 'mic' });
  };

  // From the list's «سجّل» / «صوّر»: open straight into it, once.
  useEffect(() => {
    if (started.current || existing) return;
    started.current = true;
    if (start === 'photo') void takePhoto();
    if (start === 'voice') void toggleRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A minute is plenty for one item.
  useEffect(() => {
    if (voice.recording && voice.elapsedMs >= ITEM_VOICE_MAX_MS) void toggleRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.elapsedMs]);

  // Back from the map with a pin for the shop he knows.
  useFocusEffect(
    useCallback(() => {
      const pin = shopPin.take();
      if (pin) setItem((cur) => (cur.where.kind === 'known' ? { ...cur, where: { ...cur.where, pin } } : cur));
    }, []),
  );

  const ready = itemReady(item);
  const setWhere = (where: ErrandWhere) => patch({ where });

  return (
    <Screen
      testID="shopping-item"
      edges={['bottom']}
      footer={
        <GreenBar
          label={t(existing ? 'shopping.item_save' : 'shopping.item_add')}
          onPress={() => {
            if (!ready) {
              toast.show({ message: t(item.where.kind === 'known' && !item.where.name.trim() ? 'shopping.item_need_shop' : 'shopping.item_need_what'), tone: 'warning' });
              return;
            }
            errandDraft.save({ ...item, what: item.what.trim() });
            if (router.canGoBack()) router.back();
            else router.replace('/shopping/dawwerli');
          }}
        />
      }
    >
      <ShopHeader title={t(existing ? 'shopping.item_edit_title' : 'shopping.item_new_title')} fallback="/shopping/dawwerli" />

      <Section title={t('shopping.what')}>
        <TextField value={item.what} onChangeText={(what) => patch({ what })} placeholder={t('shopping.what_placeholder')} multiline maxLength={200} />
        <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
          {item.photoUri ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], padding: 4, paddingEnd: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: shop.tint }}>
              <ProducePhoto uri={item.photoUri} label={t('shopping.photo_item')} style={{ width: 40, height: 40, borderRadius: theme.radius.md }} />
              <Text variant="footnote" weight={600} style={{ color: shop.onTint }}>
                {t('shopping.photo_added')}
              </Text>
              <IconButton icon="x" size={36} variant="plain" accessibilityLabel={t('shopping.photo_remove')} onPress={() => patch({ photoUri: null })} />
            </View>
          ) : (
            <Attach icon="camera" label={t('shopping.photo_add')} onPress={() => void takePhoto()} />
          )}
          {item.voice ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[2], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
              <IconButton
                icon={voice.playing ? 'pause' : 'play'}
                size={44}
                variant="plain"
                accessibilityLabel={t(voice.playing ? 'shopping.voice_pause' : 'shopping.voice_play')}
                onPress={() => item.voice && voice.toggle(item.voice.uri)}
              />
              <Text variant="footnote" weight={600} tabular>
                {t('shopping.voice_len', { s: Math.max(1, Math.round(item.voice.durationMs / 1000)) })}
              </Text>
              <IconButton icon="trash" size={44} variant="plain" accessibilityLabel={t('shopping.voice_remove')} onPress={() => patch({ voice: null })} />
            </View>
          ) : (
            <Attach
              icon={voice.recording ? 'pause' : 'mic'}
              label={voice.recording ? t('shopping.voice_stop', { s: Math.floor(voice.elapsedMs / 1000) }) : t('shopping.voice_add')}
              live={voice.recording}
              onPress={() => void toggleRecord()}
            />
          )}
        </View>
      </Section>

      <Section title={t('shopping.how_much')}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Stepper value={item.qty} onChange={(qty) => patch({ qty })} min={1} max={99} accessibilityLabel={t('shopping.how_much')} />
        </View>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {ERRAND_UNITS.map((u) => (
            <Choice key={u} on={item.unit === u} label={t(`shopping.unit_${u}` as MessageKey)} onPress={() => patch({ unit: u })} />
          ))}
        </View>
      </Section>

      <Section title={t('shopping.where')}>
        <WhereCard icon="location-arrow" title={t('shopping.where_near')} sub={t('shopping.where_near_sub')} on={item.where.kind === 'near'} onPress={() => setWhere({ kind: 'near' })} />
        <WhereCard
          icon="bag"
          title={t('shopping.where_app')}
          sub={item.where.kind === 'app' ? item.where.name : t('shopping.where_app_sub')}
          on={item.where.kind === 'app'}
          onPress={() => item.where.kind !== 'app' && setWhere({ kind: 'app', shopId: '', name: '' })}
        >
          {item.where.kind === 'app' ? (
            <View style={{ gap: theme.space[2] }}>
              <TextField value={shopSearch} onChangeText={setShopSearch} placeholder={t('shopping.where_app_search')} leadingIcon="search" />
              {shops.isError ? (
                <Pressable accessibilityRole="button" onPress={() => void shops.refetch()} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[2] }}>
                  <Text variant="label" color="textMuted" style={{ flex: 1 }}>
                    {t('error.generic')}
                  </Text>
                  <Text variant="label" weight={700} style={{ color: shop.fill }}>
                    {t('action.retry')}
                  </Text>
                </Pressable>
              ) : null}
              {(shops.data ?? []).slice(0, 5).map((s) => {
                const on = item.where.kind === 'app' && item.where.shopId === s.id;
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setWhere({ kind: 'app', shopId: s.id, name: s.name })}
                    style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[2], borderRadius: theme.radius.md, backgroundColor: on ? shop.tint : 'transparent' }}
                  >
                    {on ? <Icon name="check" size={16} color={shop.fill} /> : <View style={{ width: 16 }} />}
                    <Text variant="label" weight={on ? 700 : 500} style={{ flex: 1, color: on ? shop.onTint : theme.colors.text }}>
                      {s.name}
                    </Text>
                    <Text variant="caption" color="textMuted">
                      {s.kind}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </WhereCard>
        <WhereCard
          icon="map-pin"
          title={t('shopping.where_known')}
          sub={t('shopping.where_known_sub')}
          on={item.where.kind === 'known'}
          onPress={() => item.where.kind !== 'known' && setWhere({ kind: 'known', name: '', pin: null })}
        >
          {item.where.kind === 'known' ? (
            <View style={{ gap: theme.space[2] }}>
              <TextField
                value={item.where.name}
                onChangeText={(name) => item.where.kind === 'known' && setWhere({ ...item.where, name })}
                placeholder={t('shopping.where_known_placeholder')}
                maxLength={80}
              />
              <Button
                variant="secondary"
                size="md"
                icon="map-pin"
                label={item.where.pin ? t('shopping.pin_again') : t('shopping.pin_add')}
                onPress={() => router.push({ pathname: '/shopping/shop-pin', params: item.where.kind === 'known' && item.where.pin ? { lat: String(item.where.pin.lat), lng: String(item.where.pin.lng) } : {} })}
              />
              {item.where.pin ? (
                <Text variant="caption" weight={600} style={{ color: shop.fill }}>
                  {t('shopping.pin_done')}
                </Text>
              ) : null}
            </View>
          ) : null}
        </WhereCard>
      </Section>

      <Section title={t('shopping.if_missing')}>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {IF_MISSING.map((m) => (
            <Choice key={m} on={item.ifMissing === m} label={t(`shopping.missing_${m}` as MessageKey)} onPress={() => patch({ ifMissing: m })} />
          ))}
        </View>
      </Section>

      <TextField
        label={t('shopping.max_label')}
        hint={t('shopping.max_hint')}
        keyboardType="number-pad"
        value={item.maxIqd != null ? String(item.maxIqd) : ''}
        onChangeText={(v) => {
          const n = Number(v.replace(/[^0-9]/g, ''));
          patch({ maxIqd: v.trim() && n > 0 ? n : null });
        }}
        placeholder={t('shopping.max_placeholder')}
      />

      {existing ? (
        <Button
          variant="ghost"
          label={t('shopping.item_remove')}
          icon="trash"
          onPress={() => {
            errandDraft.remove(existing.id);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label" weight={700} color="textMuted">
        {title}
      </Text>
      {children}
    </View>
  );
}

function Choice({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: theme.radius.pill,
        borderWidth: on ? 2 : 1.5,
        borderColor: on ? shop.fill : theme.colors.border,
        backgroundColor: on ? shop.tint : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 4,
      }}
    >
      <Text variant="label" weight={on ? 700 : 600} numberOfLines={1} style={{ color: on ? shop.onTint : theme.colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Attach({ icon, label, onPress, live }: { icon: IconName; label: string; onPress: () => void; live?: boolean }) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: live ? theme.colors.dangerTint : theme.colors.surfaceSunken,
      }}
    >
      <Icon name={icon} size={16} color={live ? theme.colors.dangerText : shop.fill} />
      <Text variant="footnote" weight={600} tabular style={{ color: live ? theme.colors.dangerText : theme.colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

function WhereCard({ icon, title, sub, on, onPress, children }: { icon: IconName; title: string; sub: string; on: boolean; onPress: () => void; children?: React.ReactNode }) {
  const theme = useTheme();
  const shop = useShopping();
  return (
    <View style={{ borderRadius: theme.radius.lg, borderWidth: on ? 2 : 1.5, borderColor: on ? shop.fill : theme.colors.border, backgroundColor: theme.colors.surface, padding: theme.space[3], gap: theme.space[2] }}>
      <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={onPress} style={{ minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? shop.fill : theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
          {on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: shop.fill }} /> : null}
        </View>
        <Icon name={icon} size={18} color={shop.fill} />
        <Text variant="bodyStrong" weight={700} style={{ flex: 1 }}>
          {title}
        </Text>
        <Text variant="caption" color="textMuted" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {sub}
        </Text>
      </Pressable>
      {children}
    </View>
  );
}
