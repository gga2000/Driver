import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import type { PartnerJob, PartnerShopItem } from '@driver/contracts';
import { Icon, PhotoImage, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { absoluteUrl } from '@/features/account/photo';
import { PhotoViewer } from '@/features/work/PlacePhotos';
import { openNav, useNavApp } from '@/features/work/nav';
import { useT } from '@/lib/i18n';
import { amountParam } from '@/lib/money';
import { storage } from '@/lib/storage';
import { ReceiptPanel } from './ReceiptPanel';
import { listStop, MISSING_KEY, parseTicks, ticksKey, toggleTick, UNIT_KEY, whereKey } from './logic';

const THUMB = 64;
/** The list scrolls inside the card past this height, so the main button below never moves. */
const LIST_MAX_HEIGHT = 420;
const VOICE_LOAD_MS = 8_000;

/**
 * «الليستة» (دوّرلي): what the customer asked him to buy, item by item, on the shop stop until he has it
 * all. Each line: a tick he keeps on this phone, how many, where from, what to do if it's missing,
 * the customer's ceiling, the customer's photo and voice note. Amounts are the customer's own, shown
 * as given; the app does no price maths here.
 */
export default function ShopListCard({ job }: { job: PartnerJob }) {
  const theme = useTheme();
  const t = useT();
  const net = useNetwork();
  const stop = listStop(job);
  const items = stop?.shopList.items ?? [];
  const [ticks, setTicks] = useState<Set<number>>(new Set());
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const voice = useVoice();
  const key = stop ? ticksKey(stop.stopId) : null;

  useEffect(() => {
    if (!key) return;
    let live = true;
    void storage.getItem(key).then((raw) => live && setTicks(parseTicks(raw, items.length)), () => undefined);
    return () => {
      live = false;
    };
  }, [key, items.length]);

  if (!stop || items.length === 0) return null;
  const tick = (i: number) => {
    const next = toggleTick(ticks, i);
    setTicks(next);
    if (key) void storage.setItem(key, JSON.stringify([...next])).catch(() => undefined);
  };
  const done = ticks.size;
  const listMax = stop.shopList.listMaxIqd;

  return (
    <View testID="errand-list" style={{ backgroundColor: theme.colors.surfaceSunken, borderRadius: theme.radius.lg, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], paddingHorizontal: theme.space[3], paddingTop: theme.space[3], paddingBottom: theme.space[2] }}>
        <Icon name="bag" size={18} color="accentText" />
        <Text variant="label" weight={700} style={{ flex: 1 }}>
          {t('partner.errand.title')}
        </Text>
        <Text variant="caption" weight={600} color={done === items.length ? 'successText' : 'textMuted'} tabular testID="errand-count">
          {done === items.length ? t('partner.errand.all_done') : t('partner.errand.count', { done, total: items.length })}
        </Text>
      </View>
      {listMax !== null ? (
        <Text variant="caption" color="textMuted" tabular style={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[2] }} testID="errand-list-max">
          {t('partner.errand.list_max', { amount: amountParam(listMax) })}
        </Text>
      ) : null}
      {!net.online ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginHorizontal: theme.space[3], marginBottom: theme.space[2] }}>
          <Icon name="wifi-off" size={16} color="warningText" />
          <Text variant="caption" color="warningText" style={{ flex: 1 }}>
            {t('partner.errand.offline')}
          </Text>
        </View>
      ) : null}
      <ScrollView nestedScrollEnabled style={{ maxHeight: LIST_MAX_HEIGHT }} contentContainerStyle={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[3], gap: theme.space[2] }}>
        {items.map((item, i) => (
          <ItemRow key={i} i={i} item={item} ticked={ticks.has(i)} onTick={() => tick(i)} onPhoto={(url) => setPhoto({ id: `errand-${i}`, url })} voice={voice} />
        ))}
      </ScrollView>
      {stop.state === 'arrived' ? (
        <View style={{ paddingHorizontal: theme.space[3], paddingBottom: theme.space[3] }}>
          <ReceiptPanel tripId={job.tripId} stopId={stop.stopId} listMaxIqd={listMax} />
        </View>
      ) : null}
      <PhotoViewer photos={photo ? [photo] : []} index={photo ? 0 : null} onIndex={(n) => n === null && setPhoto(null)} title={t('partner.errand.title')} testIDPrefix="errand" />
    </View>
  );
}

function ItemRow({ i, item, ticked, onTick, onPhoto, voice }: { i: number; item: PartnerShopItem; ticked: boolean; onTick: () => void; onPhoto: (url: string) => void; voice: Voice }) {
  const theme = useTheme();
  const t = useT();
  const nav = useNavApp();
  const [photoDead, setPhotoDead] = useState(false);
  const where = whereKey(item);
  const pin = item.where.pin;
  return (
    <View testID={`errand-item-${i}`} style={{ flexDirection: 'row', gap: theme.space[3], backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: theme.space[3], opacity: ticked ? 0.6 : 1 }}>
      <Pressable
        testID={`errand-tick-${i}`}
        onPress={onTick}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: ticked }}
        accessibilityLabel={t('partner.errand.tick', { what: item.what })}
        hitSlop={6}
        style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ width: 28, height: 28, borderRadius: theme.radius.sm, borderWidth: 2, borderColor: ticked ? theme.colors.success : theme.colors.borderStrong, backgroundColor: ticked ? theme.colors.success : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {ticked ? <Icon name="check" size={18} color="onAccent" strokeWidth={2.5} /> : null}
        </View>
      </Pressable>

      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="label" weight={700} tabular style={ticked ? { textDecorationLine: 'line-through' } : undefined}>
          {`${t('partner.errand.qty', { qty: item.qty, unit: t(UNIT_KEY[item.unit]) })} · ${item.what}`}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], flexWrap: 'wrap' }}>
          <Text variant="caption" color="textMuted">
            {where.name ? t(where.key, { name: where.name }) : t(where.key)}
          </Text>
          {pin && nav.app ? (
            <Pressable testID={`errand-pin-${i}`} onPress={() => nav.app && void openNav(nav.app, pin)} accessibilityRole="link" hitSlop={12} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text variant="caption" weight={700} color="accentText">
                {t('partner.errand.open_shop')}
              </Text>
            </Pressable>
          ) : null}
        </View>
        <Text variant="caption" weight={600} color={item.ifMissing === 'call' ? 'warningText' : 'text'}>
          {t(MISSING_KEY[item.ifMissing])}
        </Text>
        {item.maxIqd !== null ? (
          <Text variant="caption" color="textMuted" tabular testID={`errand-max-${i}`}>
            {t('partner.errand.max', { amount: amountParam(item.maxIqd) })}
          </Text>
        ) : null}
        {item.voice ? <VoiceRow id={`v${i}`} url={item.voice.url} sec={item.voice.sec} voice={voice} testID={`errand-voice-${i}`} /> : null}
      </View>

      {item.photoUrl ? (
        photoDead ? (
          <View testID={`errand-photo-dead-${i}`} style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center', padding: 4 }}>
            <Icon name="camera" size={18} color="textMuted" />
            <Text variant="caption" color="textMuted" align="center" style={{ fontSize: 10, lineHeight: 13 }}>
              {t('partner.errand.photo_dead')}
            </Text>
          </View>
        ) : (
          <Pressable
            testID={`errand-photo-${i}`}
            onPress={() => onPhoto(item.photoUrl!)}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('partner.errand.photo_open', { what: item.what })}
            style={{ width: THUMB, height: THUMB, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}
          >
            <PhotoImage uri={absoluteUrl(item.photoUrl)} style={{ width: THUMB, height: THUMB }} onError={() => setPhotoDead(true)} />
          </Pressable>
        )
      ) : null}
    </View>
  );
}

interface Voice {
  active: string | null;
  state: 'idle' | 'loading' | 'playing';
  toggle: (id: string, url: string) => void;
}

/** One player for the whole list: a note plays only when he taps it (never by itself), one at a time. */
function useVoice(): Voice {
  const t = useT();
  const toast = useToast();
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [active, setActive] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    if (status.playing) clear();
  }, [status.playing]);
  useEffect(() => {
    if (!status.didJustFinish) return;
    setActive(null);
    void player.seekTo(0).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.didJustFinish]);
  useEffect(() => clear, []);
  return {
    active,
    state: !active ? 'idle' : status.playing ? 'playing' : 'loading',
    toggle: (id, url) => {
      if (id === active) {
        clear();
        player.pause();
        setActive(null);
        return;
      }
      clear();
      void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
      player.replace({ uri: absoluteUrl(url) });
      setActive(id);
      player.play();
      timer.current = setTimeout(() => {
        // Never started: no network, or the link expired (pulling the job down mints fresh ones).
        player.pause();
        setActive(null);
        toast.show({ message: t('partner.errand.voice_failed'), tone: 'warning', icon: 'mic' });
      }, VOICE_LOAD_MS);
    },
  };
}

function VoiceRow({ id, url, sec, voice, testID }: { id: string; url: string; sec: number; voice: Voice; testID: string }) {
  const theme = useTheme();
  const t = useT();
  const mine = voice.active === id;
  const state = mine ? voice.state : 'idle';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], marginTop: 2 }}>
      <Pressable
        testID={testID}
        onPress={() => voice.toggle(id, url)}
        accessibilityRole="button"
        accessibilityLabel={t(state === 'playing' ? 'partner.errand.voice_stop' : 'partner.errand.voice_play')}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        {state === 'loading' ? <ActivityIndicator size="small" color={theme.colors.onAccent} /> : <Icon name={state === 'playing' ? 'pause' : 'play'} size={20} color="onAccent" filled strokeWidth={1.5} />}
      </Pressable>
      <Text variant="caption" weight={600} color="textMuted" tabular>
        {t('partner.errand.voice', { n: sec })}
      </Text>
    </View>
  );
}

