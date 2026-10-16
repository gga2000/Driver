import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { AgreementKind, LatLng } from '@driver/contracts';
import { color as palette } from '@driver/design-tokens';
import { Button, Icon, IconButton, Text, TextField, useTheme, useToast } from '@driver/ui';
import { currentFix, locationDeniedToast } from '@/features/account/device';
import { PinPicker } from '@/features/places/PinPicker';
import { useAskAgreement } from '@/features/rajaa/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

const PIN_SETTLE_MS = 1_500;

/**
 * Step 4 agreed trip prices: the rider puts the pin where the car should pick him up on the road, or
 * the door it should drop him at, adds a landmark if he likes, and asks the driver for a price. The
 * server checks the place (on the way; near the far garage) and answers with the ask; the booking
 * screen then shows it waiting for the driver.
 */
export default function AskAgreedPrice() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ departureId: string; kind: string; lat: string; lng: string; city?: string }>();
  const kind: AgreementKind = params.kind === 'door_drop' ? 'door_drop' : 'pin_pickup';
  const start: LatLng = { lat: Number(params.lat) || 32.905, lng: Number(params.lng) || 45.06 };
  const city = params.city ?? '';
  const [pin, setPin] = useState<LatLng>(start);
  const [moving, setMoving] = useState(false);
  const [recentre, setRecentre] = useState<{ pin: LatLng; seq: number; accuracyM?: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState('');
  const ask = useAskAgreement();

  // A touch that lifts the pin without moving the camera sends no "settled": settle it after a moment.
  useEffect(() => {
    if (!moving) return;
    const id = setTimeout(() => setMoving(false), PIN_SETTLE_MS);
    return () => clearTimeout(id);
  }, [moving, pin]);

  const locate = async () => {
    setLocating(true);
    const fix = await currentFix();
    setLocating(false);
    if (fix === 'denied') toast.show(locationDeniedToast(t));
    else if (!fix) toast.show({ message: t('error.location_weak'), tone: 'danger' });
    else setRecentre({ pin: fix.pin, seq: Date.now(), ...(fix.accuracyM ? { accuracyM: fix.accuracyM } : {}) });
  };

  const send = () =>
    ask.mutate(
      { departureId: String(params.departureId ?? ''), kind, lat: pin.lat, lng: pin.lng, ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          toast.show({ message: t('rajaa.agree_sent'), icon: 'send' });
          router.back();
        },
      },
    );

  return (
    <View testID="rajaa-agree" style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1 }}>
        <PinPicker initial={start} onCentre={setPin} onMoving={setMoving} recentre={recentre} tone={kind === 'pin_pickup' ? 'pickup' : 'dropoff'} testID="rajaa-agree-map" />
        <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + theme.space[3], left: theme.space[4], right: theme.space[4], flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <IconButton icon="chevron-back" variant="outline" accessibilityLabel={t('action.back')} onPress={() => router.back()} style={{ backgroundColor: theme.colors.surface }} testID="rajaa-agree-back" />
          <View style={{ flexShrink: 1, paddingHorizontal: theme.space[4], paddingVertical: theme.space[1], minHeight: 44, borderRadius: 22, justifyContent: 'center', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
            <Text variant="bodyStrong" numberOfLines={1}>
              {t(kind === 'pin_pickup' ? 'rajaa.agree_map_title_pin' : 'rajaa.agree_map_title_door')}
            </Text>
          </View>
        </View>
        <View pointerEvents="box-none" style={{ position: 'absolute', bottom: theme.space[4], left: theme.space[4] }}>
          <Button
            testID="rajaa-agree-locate"
            label={t('rajaa.agree_map_me')}
            icon="location-arrow"
            variant="secondary"
            size="sm"
            loading={locating}
            onPress={() => void locate()}
          />
        </View>
      </View>

      <View
        style={{
          marginTop: -theme.space[5],
          paddingTop: theme.space[5],
          paddingHorizontal: theme.space[5],
          paddingBottom: Math.max(insets.bottom, theme.space[4]),
          gap: theme.space[3],
          backgroundColor: theme.colors.surfaceRaised,
          borderTopLeftRadius: theme.radius['2xl'],
          borderTopRightRadius: theme.radius['2xl'],
          shadowColor: palette.neutral[1000],
          shadowOpacity: 0.12,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 10,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint }}>
            <Icon name={kind === 'pin_pickup' ? 'map-pin' : 'home'} size={20} color="accentText" strokeWidth={2} />
          </View>
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {kind === 'pin_pickup' ? t('rajaa.agree_map_rule_pin') : t('rajaa.agree_map_rule_door', { city })}
          </Text>
        </View>
        <TextField
          testID="rajaa-agree-note"
          label={t('rajaa.agree_map_note')}
          placeholder={t('rajaa.agree_map_note_placeholder')}
          value={note}
          onChangeText={setNote}
          maxLength={200}
        />
        {ask.isError ? (
          <Text variant="footnote" color="dangerText" testID="rajaa-agree-error" accessibilityLiveRegion="polite">
            {apiErrorMessage(ask.error, t('error.network'), locale)}
          </Text>
        ) : null}
        <Button testID="rajaa-agree-send" size="lg" fullWidth icon="send" label={t('rajaa.agree_map_send')} disabled={moving} loading={ask.isPending} haptic="success" onPress={send} />
      </View>
    </View>
  );
}
