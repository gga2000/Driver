import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useMutation } from '@tanstack/react-query';
import type { LatLng } from '@driver/contracts';
import { Button, ChipGroup, ModalSheet, Text, TextField, useNetwork, useTheme, useToast } from '@driver/ui';
import { useApi } from '@/lib/api';
import { apiErrorCode } from '@/lib/api-links';
import { useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { storage } from '@/lib/storage';
import { askedKey, mapFixFailed, mapFixKinds, type MapFixKind } from './map-fix';

/** The courier works in one city today. */
const CITY_ID = 'aziziyah';
const NOTE_MAX = 200;

const KIND_KEY = {
  moved: 'partner.mapfix_kind_moved',
  wrong_name: 'partner.mapfix_kind_wrong_name',
  closed: 'partner.mapfix_kind_closed',
  new_place: 'partner.mapfix_kind_new_place',
} as const satisfies Record<MapFixKind, string>;

export interface MapFixRestaurant {
  orgId: string;
  name: string;
}

/** One send for both the menu sheet and the after-pickup question: thanks, or why it did not go. */
function useSendFix() {
  const api = useApi();
  const t = useT();
  const toast = useToast();
  const net = useNetwork();
  const theme = useTheme();
  const report = useMutation(api.ops.mapEditor.report.mutationOptions());
  const send = async (input: { kind: MapFixKind; restaurant: MapFixRestaurant | null; pin?: LatLng; name_ar?: string; note?: string }): Promise<boolean> => {
    if (!net.online) {
      toast.show({ message: t('partner.mapfix_offline'), tone: 'warning', icon: 'wifi' });
      return false;
    }
    try {
      await report.mutateAsync({
        cityId: CITY_ID,
        kind: input.kind,
        ...(input.restaurant && input.kind !== 'new_place' ? { target: { kind: 'restaurant' as const, id: input.restaurant.orgId } } : {}),
        ...(input.pin ? { pin: input.pin } : {}),
        ...(input.name_ar ? { name_ar: input.name_ar } : {}),
        ...(input.note ? { note: input.note } : {}),
      });
      theme.haptic('success');
      toast.show({ message: t('partner.mapfix_thanks'), tone: 'success', icon: 'check' });
      return true;
    } catch (err) {
      toast.show({ message: t(mapFixFailed(apiErrorCode(err), net.online)), tone: 'warning' });
      return false;
    }
  };
  return { send, sending: report.isPending };
}

/**
 * «الخريطة غلط» from the job's «مشكلة» sheet (Ali's pick C, 2026-10-22): what is wrong, then where he
 * stands now is the place (no map to drag on a moving phone) or the right name. It lands in the
 * Console's «المراجعة»; nothing on the map changes until the team accepts it.
 */
export function MapFixSheet({ visible, restaurant, onClose }: { visible: boolean; restaurant: MapFixRestaurant | null; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const { send, sending } = useSendFix();
  const kinds = mapFixKinds(restaurant !== null);
  const [kind, setKind] = useState<MapFixKind>(kinds[0]!);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [locating, setLocating] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setKind(kinds[0]!);
    setName('');
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, restaurant?.orgId]);

  const needsPlace = kind === 'moved' || kind === 'new_place';
  const needsName = kind === 'wrong_name' || kind === 'new_place';
  const ready = !needsName || name.trim().length > 0;

  const submit = async () => {
    if (!ready || sending || locating) return;
    let pin: LatLng | undefined;
    if (needsPlace) {
      setLocating(true);
      const fix = await currentFix(6000).finally(() => setLocating(false));
      if (!fix) {
        toast.show({ message: t('partner.mapfix_no_fix'), tone: 'warning', icon: 'map-pin' });
        return;
      }
      pin = { lat: fix.lat, lng: fix.lng };
    }
    const ok = await send({ kind, restaurant, ...(pin ? { pin } : {}), ...(needsName ? { name_ar: name.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    if (ok) onClose();
  };

  const busy = sending || locating;
  return (
    <ModalSheet visible={visible} onClose={() => (busy ? undefined : onClose())} locked={busy} title={restaurant ? t('partner.mapfix_title', { name: restaurant.name }) : t('partner.mapfix_title_new')} testID="mapfix-sheet" sheetMaxWidth={560}>
      <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(160)} style={{ gap: theme.space[3] }}>
        {kinds.length > 1 ? (
          <ChipGroup
            items={kinds.map((k) => ({ id: k, label: t(KIND_KEY[k]) }))}
            value={[kind]}
            onChange={(next) => next[0] && setKind(next[0] as MapFixKind)}
            required
            columns={2}
            accessibilityLabel={t('partner.mapfix_kind_label')}
          />
        ) : null}
        {needsName ? (
          <TextField
            label={t(kind === 'new_place' ? 'partner.mapfix_name_new' : 'partner.mapfix_name_right')}
            value={name}
            onChangeText={setName}
            maxLength={60}
            testID="mapfix-name"
          />
        ) : null}
        {needsPlace ? (
          <Text variant="caption" color="textMuted">
            {t(kind === 'moved' ? 'partner.mapfix_place_moved' : 'partner.mapfix_place_new')}
          </Text>
        ) : null}
        <TextField label={t('partner.mapfix_note')} hint={t('partner.mapfix_note_hint')} value={note} onChangeText={setNote} maxLength={NOTE_MAX} testID="mapfix-note" />
        <Button
          label={needsPlace ? t('partner.mapfix_send_here') : t('partner.mapfix_send')}
          size="lg"
          fullWidth
          disabled={!ready}
          loading={busy}
          loadingLabel={t(locating ? 'partner.mapfix_locating' : 'partner.mapfix_sending')}
          onPress={() => void submit()}
          testID="mapfix-send"
        />
      </Animated.View>
    </ModalSheet>
  );
}

export interface PickupAsk extends MapFixRestaurant {
  distanceM: number;
  /** Where he picked up: the kitchen's real place if he says «إي». */
  at: LatLng;
}

/** Remembers on this phone that he was asked about this kitchen, so it is asked once whatever he said. */
export async function markAsked(orgId: string): Promise<void> {
  await storage.setItem(askedKey(orgId), '1').catch(() => undefined);
}
export async function wasAsked(orgId: string): Promise<boolean> {
  return (await storage.getItem(askedKey(orgId)).catch(() => null)) !== null;
}

/**
 * After a pickup far from the kitchen's pin: «"مطعم خالد" جان هنا؟». One tap sends where he stood; «لا»
 * just closes. Asked once per kitchen on this phone.
 */
export function PickupMapAsk({ ask, onClose }: { ask: PickupAsk | null; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const { send, sending } = useSendFix();
  const [last, setLast] = useState<PickupAsk | null>(ask);
  useEffect(() => {
    if (ask) {
      setLast(ask);
      void markAsked(ask.orgId);
    }
  }, [ask]);
  const shown = ask ?? last;
  const yes = async () => {
    if (!shown || sending) return;
    await send({ kind: 'moved', restaurant: shown, pin: shown.at });
    onClose();
  };
  return (
    <ModalSheet visible={ask !== null} onClose={() => (sending ? undefined : onClose())} locked={sending} title={shown ? t('partner.mapfix_ask_title', { name: shown.name }) : ''} testID="mapfix-ask" sheetMaxWidth={560}>
      <View style={{ gap: theme.space[3] }}>
        <Text variant="body" color="textMuted">
          {shown ? t('partner.mapfix_ask_body', { m: shown.distanceM }) : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          <View style={{ flex: 1 }}>
            <Button label={t('partner.mapfix_ask_yes')} size="lg" fullWidth loading={sending} loadingLabel={t('partner.mapfix_sending')} onPress={() => void yes()} testID="mapfix-ask-yes" />
          </View>
          <View style={{ flex: 1 }}>
            <Button label={t('partner.mapfix_ask_no')} variant="secondary" size="lg" fullWidth disabled={sending} onPress={onClose} testID="mapfix-ask-no" />
          </View>
        </View>
        <Text variant="caption" color="textMuted" align="center">
          {t('partner.mapfix_ask_once')}
        </Text>
      </View>
    </ModalSheet>
  );
}
