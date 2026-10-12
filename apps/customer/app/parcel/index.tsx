import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { PARCEL_RULES, type LatLng, type ParcelPayer, type ParcelSize } from '@driver/contracts';
import { Avatar, Icon, ltr, PhotoImage, Screen, SegmentedControl, Text, TextField, useNetwork, useTheme, useToast } from '@driver/ui';
import { pickGatePhoto, uploadPhoto, type PhotoSource } from '@/features/account/device';
import { zoneCentre } from '@/features/account/geo';
import { useDeliverTo } from '@/features/food/queries';
import { DoorPinPanel } from '@/features/parcel/DoorPinPanel';
import { newRequestId, PARCEL_SIZES, parseValue, valueProblem, whatProblem } from '@/features/parcel/logic';
import { parcelSwatch } from '@/features/parcel/palette';
import { ParcelButton } from '@/features/parcel/ParcelButton';
import { OptionCard, SectionLabel, TopBar } from '@/features/parcel/Parts';
import { PARCEL_CITY_ID, useParcelCache, useParcelQuote, useReceiverOptions } from '@/features/parcel/queries';
import { ReceiverSheet, receiverInput, type ReceiverPick } from '@/features/parcel/ReceiverSheet';
import { ZoneSheet } from '@/features/parcel/ZoneSheet';
import { placeLabelKey } from '@/features/places/PlaceForm';
import { apiErrorCode, apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, groupDigits, iqd } from '@/lib/money';
import { displayPhone } from '@/lib/phone';
import { zoneName } from '@/lib/profile';

const SIZE: Record<ParcelSize, { label: 'parcel.c_size_small' | 'parcel.c_size_medium' | 'parcel.c_size_large'; hint: 'parcel.c_size_small_hint' | 'parcel.c_size_medium_hint' | 'parcel.c_size_large_hint' }> = {
  small: { label: 'parcel.c_size_small', hint: 'parcel.c_size_small_hint' },
  medium: { label: 'parcel.c_size_medium', hint: 'parcel.c_size_medium_hint' },
  large: { label: 'parcel.c_size_large', hint: 'parcel.c_size_large_hint' },
};

/** Where the receiver's map opens when the sender marks the door: the area picked, else the town centre. */
const TOWN: LatLng = { lat: 32.9085, lng: 45.0655 };

/**
 * «دز طرد» (concept A1, Ali 2026-10-12): one sheet — a photo of the thing (optional), a few words, its size and
 * value, who it is for, where it goes (by default the receiver marks their own door from a text-message link,
 * no app needed; or the sender pins it now), who pays the cash fare, and the server's fare on «دزّه». One request
 * id per attempt, kept across retries, so a send that timed out and is tapped again never sends two parcels.
 */
export default function SendParcel() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const client = useApiClient();
  const net = useNetwork();
  const sw = parcelSwatch(theme);
  const putView = useParcelCache();
  const params = useLocalSearchParams<{ for?: string }>();

  const { place, dropoff: pickup } = useDeliverTo();
  const options = useReceiverOptions();

  const [photo, setPhoto] = useState<{ id: string; uri: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [what, setWhat] = useState('');
  const [size, setSize] = useState<ParcelSize>('small');
  const [valueText, setValueText] = useState('');
  const [receiver, setReceiver] = useState<ReceiverPick | null>(null);
  const [receiverOpen, setReceiverOpen] = useState(false);
  const [doorBy, setDoorBy] = useState<'receiver' | 'sender'>('receiver');
  const [zoneKey, setZoneKey] = useState<string | null>(null);
  const [zoneOpen, setZoneOpen] = useState(false);
  const [door, setDoor] = useState<{ pin: LatLng; zoneKey: string } | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [payer, setPayer] = useState<ParcelPayer>('sender');
  const [sending, setSending] = useState(false);
  const [checked, setChecked] = useState(false);
  const requestId = useRef(newRequestId());

  // «دز طرد ثاني» from a delivered parcel: the same person when they are one of his offered people.
  useEffect(() => {
    if (receiver || !params.for) return;
    const match = options.find((o) => o.name === params.for && o.pick.kind !== 'recent');
    if (match && match.pick.kind !== 'recent') setReceiver(match.pick);
  }, [options, params.for, receiver]);

  const value = parseValue(valueText);
  const dropZoneKey = doorBy === 'receiver' ? zoneKey : (door?.zoneKey ?? null);
  const quote = useParcelQuote(pickup, dropZoneKey, size);
  const fare = quote.data && quote.data.zoneKey === dropZoneKey ? quote.data.fareIqd : null;

  const problems = {
    what: whatProblem(what),
    value: valueProblem(value),
    receiver: receiver ? null : 'required',
    door: doorBy === 'receiver' ? (zoneKey ? null : 'required') : door ? null : 'required',
    pickup: pickup ? null : 'required',
  };
  const ready = Object.values(problems).every((p) => p === null) && fare !== null && !uploading;

  const addPhoto = async (source: PhotoSource) => {
    const picked = await pickGatePhoto(source);
    if (picked === 'denied') return toast.show({ message: t('error.camera_denied'), tone: 'danger' });
    if (!picked) return;
    setUploading(true);
    try {
      const id = await uploadPhoto(picked, (input) => client.places.photoUpload.mutate(input));
      setPhoto({ id, uri: picked.uri });
    } catch {
      toast.show({ message: t('error.upload_failed'), tone: 'danger' });
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    setChecked(true);
    if (!net.online) return toast.show({ message: t('parcel.c_offline'), tone: 'neutral', icon: 'wifi-off' });
    if (!ready || !receiver || !pickup || fare === null || value === null) {
      theme.haptic('error');
      if (problems.receiver) setReceiverOpen(true);
      else if (problems.door && doorBy === 'receiver') setZoneOpen(true);
      else if (problems.door) setPinOpen(true);
      else if (problems.pickup) router.push('/places');
      return;
    }
    setSending(true);
    try {
      const view = await client.parcels.send.mutate({
        cityId: PARCEL_CITY_ID,
        clientRequestId: requestId.current,
        what: what.trim(),
        size,
        declaredValueIqd: value,
        ...(photo ? { photoUploadId: photo.id } : {}),
        recipient: receiverInput(receiver),
        pickup,
        door: doorBy === 'receiver' ? { by: 'receiver', zoneKey: zoneKey! } : { by: 'sender', dropoff: { zoneKey: door!.zoneKey, pin: door!.pin } },
        payer,
        fareIqd: fare,
      });
      theme.haptic('success');
      putView(view);
      requestId.current = newRequestId();
      router.replace({ pathname: '/parcel/[id]', params: { id: view.id } });
    } catch (err) {
      const code = apiErrorCode(err);
      if (code === 'price_changed') {
        // The fare moved (a pin in another area, a new rule): show the new one and let him send again.
        const fresh = await quote.refetch();
        const next = fresh.data?.fareIqd;
        toast.show({ message: next ? t('parcel.c_price_changed', { amount: amountParam(next) }) : t('parcel.c_quote_failed'), tone: 'warning' }, 6000);
      } else {
        toast.show({ message: apiErrorMessage(err, t('error.network'), locale), tone: 'danger' }, 6000);
      }
    } finally {
      setSending(false);
    }
  };

  const fromText = place ? t('parcel.c_from', { place: `${place.title ?? t(placeLabelKey(place.label))}، ${zoneName(place.zoneId, locale)}` }) : t('parcel.c_from_none');
  const amount = fare !== null ? iqd(fare, { locale }) : quote.isFetching && dropZoneKey ? t('parcel.c_quote_loading') : null;

  return (
    <View style={{ flex: 1 }}>
      <Screen
        testID="parcel-send"
        footer={
          <View style={{ gap: theme.space[3] }}>
            <Pressable accessibilityRole="button" onPress={() => router.push('/places')} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2] }} testID="parcel-from">
              <Icon name={place?.label === 'home' ? 'home' : 'map-pin'} size={18} color={place ? 'textMuted' : 'dangerText'} />
              <Text variant="label" color={place ? 'textMuted' : 'dangerText'} numberOfLines={1} style={{ flexShrink: 1 }}>
                {fromText}
              </Text>
            </Pressable>
            {quote.isError && dropZoneKey ? (
              <Pressable accessibilityRole="button" onPress={() => void quote.refetch()} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }} testID="parcel-quote-retry">
                <Text variant="label" color="dangerText" align="center">
                  {`${t('parcel.c_quote_failed')} · ${t('action.retry')}`}
                </Text>
              </Pressable>
            ) : !net.online ? (
              <Text variant="label" color="textMuted" align="center" testID="parcel-offline">
                {t('parcel.c_offline')}
              </Text>
            ) : null}
            <ParcelButton label={sending ? t('parcel.c_sending') : t('parcel.c_send')} amount={amount} loading={sending} disabled={!net.online} onPress={() => void send()} testID="parcel-send-button" />
          </View>
        }
      >
        <TopBar title={t('parcel.c_title')} backLabel={t('action.back')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />

        {/* The thing itself: a few words and, if he likes, a photo (concept A1's card). */}
        <View style={{ flexDirection: 'row', gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius['2xl'], backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
          <View style={{ flex: 1, gap: theme.space[2] }}>
            <SectionLabel>{t('parcel.c_what_label')}</SectionLabel>
            <TextField
              testID="parcel-what"
              value={what}
              onChangeText={setWhat}
              placeholder={t('parcel.c_what_placeholder')}
              maxLength={PARCEL_RULES.whatMax}
              returnKeyType="done"
              {...(checked && problems.what ? { error: t('parcel.c_what_required') } : {})}
            />
            {photo ? (
              <Pressable accessibilityRole="button" onPress={() => void addPhoto(Platform.OS === 'web' ? 'library' : 'camera')} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }} testID="parcel-photo-change">
                <Icon name="camera" size={18} color={sw.text} />
                <Text variant="label" weight={700} color={sw.text}>
                  {t('parcel.c_photo_change')}
                </Text>
              </Pressable>
            ) : (
              <Text variant="caption" color="textMuted">
                {uploading ? t('parcel.c_photo_uploading') : t('parcel.c_photo_hint')}
              </Text>
            )}
          </View>
          <PhotoTile uri={photo?.uri ?? null} uploading={uploading} onCamera={() => void addPhoto('camera')} onLibrary={() => void addPhoto('library')} />
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('parcel.size')}</SectionLabel>
          <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: theme.space[2] }}>
            {PARCEL_SIZES.map((s) => {
              const on = s === size;
              return (
                <Pressable
                  key={s}
                  testID={`parcel-size-${s}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${t(SIZE[s].label)}، ${t(SIZE[s].hint)}`}
                  onPress={() => {
                    theme.haptic('selection');
                    setSize(s);
                  }}
                  style={{ flex: 1, minHeight: 64, paddingVertical: theme.space[2], paddingHorizontal: theme.space[2], borderRadius: theme.radius.lg, alignItems: 'center', justifyContent: 'center', gap: 2, borderWidth: on ? 1.5 : 1, borderColor: on ? sw.fill : theme.colors.border, backgroundColor: on ? sw.wash : theme.colors.surface }}
                >
                  <Text variant="bodyStrong" color={on ? sw.text : 'text'}>
                    {t(SIZE[s].label)}
                  </Text>
                  <Text variant="caption" color="textMuted" numberOfLines={1}>
                    {t(SIZE[s].hint)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('parcel.c_value_label')}</SectionLabel>
          <TextField
            testID="parcel-value"
            value={valueText}
            onChangeText={(v) => {
              const n = parseValue(v.replace(/[^\d٠-٩,،]/g, ''));
              setValueText(n === null ? v : n === 0 && !/\d|[٠-٩]/.test(v) ? '' : groupDigits(n));
            }}
            placeholder="0"
            keyboardType="number-pad"
            maxLength={9}
            trailing={
              <Text variant="label" color="textMuted">
                {t('quote.currency')}
              </Text>
            }
            hint={t('parcel.c_value_hint', { amount: amountParam(Math.min(value ?? 0, PARCEL_RULES.declaredValueMaxIqd) || PARCEL_RULES.declaredValueMaxIqd) })}
            {...(problems.value === 'too_high' ? { error: t('parcel.c_value_too_high', { amount: amountParam(PARCEL_RULES.declaredValueMaxIqd) }) } : {})}
          />
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('parcel.c_for_label')}</SectionLabel>
          <Pressable
            testID="parcel-receiver"
            accessibilityRole="button"
            accessibilityLabel={`${t('parcel.c_for_label')} ${receiver?.name ?? t('parcel.c_for_pick')}`}
            onPress={() => setReceiverOpen(true)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], minHeight: 72, borderRadius: theme.radius['2xl'], backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface, borderWidth: 1, borderColor: checked && problems.receiver ? theme.colors.danger : theme.colors.border })}
          >
            {receiver ? <Avatar name={receiver.name} size={48} /> : <Avatar name="?" icon="user" size={48} />}
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="title" numberOfLines={1} color={receiver ? 'text' : 'textMuted'}>
                {receiver?.name ?? t('parcel.c_for_pick')}
              </Text>
              {receiver?.kind === 'typed' ? (
                <Text variant="label" color="textMuted" tabular>
                  {ltr(displayPhone(receiver.phone))}
                </Text>
              ) : checked && problems.receiver ? (
                <Text variant="caption" color="dangerText">
                  {t('parcel.c_for_required')}
                </Text>
              ) : null}
            </View>
            <Icon name="chevron-down" size={20} color="textMuted" />
          </Pressable>
        </View>

        <View style={{ gap: theme.space[2] }} accessibilityRole="radiogroup">
          <SectionLabel>{t('parcel.c_door_label')}</SectionLabel>
          <OptionCard title={t('parcel.c_door_receiver')} sub={t('parcel.c_door_receiver_sub')} selected={doorBy === 'receiver'} onPress={() => setDoorBy('receiver')} testID="parcel-door-receiver">
            <PickRow
              icon="map-pin"
              label={zoneKey ? zoneName(zoneKey, locale) : t('parcel.c_area_pick')}
              caption={zoneKey ? t('parcel.c_area_hint') : t('parcel.c_area_label')}
              missing={checked && !zoneKey}
              onPress={() => setZoneOpen(true)}
              testID="parcel-zone"
            />
          </OptionCard>
          <OptionCard title={t('parcel.c_door_sender')} sub={t('parcel.c_door_sender_sub')} selected={doorBy === 'sender'} onPress={() => setDoorBy('sender')} testID="parcel-door-sender">
            <PickRow
              icon={door ? 'check' : 'map-pin'}
              label={door ? t('parcel.c_pin_done', { area: zoneName(door.zoneKey, locale) }) : t('parcel.c_pin_open')}
              caption={door ? t('parcel.c_pin_change') : null}
              missing={checked && !door}
              onPress={() => setPinOpen(true)}
              testID="parcel-pin"
            />
          </OptionCard>
        </View>

        <View style={{ gap: theme.space[2] }}>
          <SectionLabel>{t('parcel.c_payer_label')}</SectionLabel>
          <SegmentedControl
            accessibilityLabel={t('parcel.c_payer_label')}
            testIDPrefix="parcel-payer"
            value={payer}
            onChange={setPayer}
            options={[
              { value: 'sender', label: t('parcel.c_payer_sender') },
              { value: 'receiver', label: t('parcel.c_payer_receiver') },
            ]}
          />
          <Text variant="caption" color="textMuted">
            {t(payer === 'sender' ? 'parcel.c_payer_sender_note' : 'parcel.c_payer_receiver_note')}
          </Text>
        </View>
      </Screen>

      {receiverOpen ? (
        <ReceiverSheet
          pick={receiver}
          options={options}
          onPick={(p) => {
            setReceiver(p);
            setReceiverOpen(false);
          }}
          onClose={() => setReceiverOpen(false)}
        />
      ) : null}
      {zoneOpen ? (
        <ZoneSheet
          value={zoneKey}
          onPick={(z) => {
            setZoneKey(z);
            setZoneOpen(false);
          }}
          onClose={() => setZoneOpen(false)}
        />
      ) : null}
      {pinOpen ? (
        <DoorPinPanel
          initial={door?.pin ?? (zoneKey ? zoneCentre(zoneKey) : null) ?? TOWN}
          onSet={(pin, z) => {
            setDoor({ pin, zoneKey: z });
            setPinOpen(false);
          }}
          onClose={() => setPinOpen(false)}
        />
      ) : null}
    </View>
  );
}

/** The photo square at the card's end: the picture once taken, else «صوّره» (and «من الصور» on a phone). */
function PhotoTile({ uri, uploading, onCamera, onLibrary }: { uri: string | null; uploading: boolean; onCamera: () => void; onLibrary: () => void }) {
  const theme = useTheme();
  const t = useT();
  const sw = parcelSwatch(theme);
  const web = Platform.OS === 'web';
  const box = { width: 112, height: 112, borderRadius: theme.radius.xl } as const;
  if (uri) {
    return (
      <View style={[box, { overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }]}>
        <PhotoImage uri={uri} style={{ width: '100%', height: '100%' }} accessibilityLabel={t('parcel.c_photo_item')} eager />
      </View>
    );
  }
  return (
    <View style={{ gap: theme.space[1] }}>
      <Pressable
        testID="parcel-photo-add"
        accessibilityRole="button"
        accessibilityLabel={web ? t('parcel.c_photo_pick') : t('parcel.c_photo_add')}
        disabled={uploading}
        onPress={web ? onLibrary : onCamera}
        style={({ pressed }) => [box, { alignItems: 'center', justifyContent: 'center', gap: theme.space[1], borderWidth: 1.5, borderStyle: 'dashed', borderColor: sw.fill, backgroundColor: pressed ? sw.wash : theme.colors.surfaceSunken }]}
      >
        <Icon name="camera" size={26} color={sw.text} strokeWidth={2} />
        <Text variant="label" weight={700} color={sw.text}>
          {web ? t('parcel.c_photo_pick') : t('parcel.c_photo_add')}
        </Text>
      </Pressable>
      {!web ? (
        <Pressable accessibilityRole="button" onPress={onLibrary} disabled={uploading} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }} testID="parcel-photo-library">
          <Text variant="caption" weight={600} color={sw.text}>
            {t('parcel.c_photo_pick')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A row inside a chosen option: what it is set to, or the ask; tapping opens its picker. */
function PickRow({ icon, label, caption, missing, onPress, testID }: { icon: 'map-pin' | 'check'; label: string; caption: string | null; missing: boolean; onPress: () => void; testID: string }) {
  const theme = useTheme();
  const sw = parcelSwatch(theme);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 52, paddingHorizontal: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface, borderWidth: 1, borderColor: missing ? theme.colors.danger : theme.colors.border })}
    >
      <Icon name={icon} size={20} color={sw.text} strokeWidth={2.2} />
      <View style={{ flex: 1, gap: 2, paddingVertical: theme.space[2] }}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {label}
        </Text>
        {caption ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {caption}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-down" size={18} color="textMuted" />
    </Pressable>
  );
}
