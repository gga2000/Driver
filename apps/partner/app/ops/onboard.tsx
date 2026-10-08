import { router, Stack } from 'expo-router';
import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import type { MerchantOnboardingView } from '@driver/contracts';
import { Button, Card, Chip, Icon, StatusPill, Text, TextField, useTheme, useToast, withAlpha } from '@driver/ui';
import { ChoiceCard } from '@/components/ChoiceCard';
import { Screen } from '@/components/Screen';
import { DriverMap } from '@/features/map/DriverMap';
import {
  emptyDraft,
  failedCount,
  nearestZone,
  ONBOARD_STEPS,
  onboardingInput,
  photosKey,
  SETTLE_KEY,
  SETTLEMENT_MODES,
  DEFAULT_SETTLEMENT,
  STEP_KEY,
  stepReady,
  zoneOptions,
  type OnboardDraft,
  type OnboardStep,
} from '@/features/ops/logic';
import { CameraGlyph, StepBar } from '@/features/ops/OpsParts';
import { pickPhotos, uploadPhoto, type PickedPhoto } from '@/features/ops/photos';
import { useMerchantOnboarding } from '@/features/ops/queries';
import { apiErrorMessage, useApiClient } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { displayPhone, formatPhoneInput, normalizeIraqiPhone } from '@/lib/phone';
import { color } from '@driver/design-tokens';

/**
 * تسجيل محل — the merchant onboarding visit: shop name and type, the owner's name and number,
 * where it is (area + a pin at the door), photos of every menu page, how the shop wants its cash
 * back, then review and submit. `ops.merchantOnboarding` drafts the shop and opens a follow-up task.
 */
export default function OpsOnboard() {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const submit = useMerchantOnboarding();
  const [d, setD] = useState<OnboardDraft>(emptyDraft);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<MerchantOnboardingView | null>(null);
  const step = ONBOARD_STEPS[index]!;
  const last = index === ONBOARD_STEPS.length - 1;
  const patch = (p: Partial<OnboardDraft>) => setD((x) => ({ ...x, ...p }));

  const next = async () => {
    if (!stepReady(step, d)) return;
    if (!last) return setIndex(index + 1);
    try {
      setDone(await submit.mutateAsync(onboardingInput(d)));
    } catch (err) {
      toast.show({ tone: 'danger', message: apiErrorMessage(err, t('error.network'), locale) });
    }
  };

  if (done) {
    return (
      <Screen
        edges={['bottom']}
        testID="ops-onboard-done"
        footer={
          <View style={{ gap: theme.space[2] }}>
            <Button
              testID="ops-onboard-another"
              label={t('partner.ops_ob_another')}
              fullWidth
              size="lg"
              onPress={() => {
                setD(emptyDraft());
                setIndex(0);
                setDone(null);
              }}
            />
            <Button label={t('partner.ops_back_home')} variant="ghost" fullWidth onPress={() => router.back()} />
          </View>
        }
      >
        <Stack.Screen options={{ title: t('partner.ops_ob_title') }} />
        <View style={{ alignItems: 'center', gap: theme.space[3], paddingTop: theme.space[10] }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: theme.colors.successTint, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={36} color="successText" strokeWidth={2.6} />
          </View>
          <Text variant="heading" align="center">
            {t('partner.ops_ob_done_title', { name: d.name.trim() })}
          </Text>
          <StatusPill label={t('partner.ops_ob_draft')} tone="warning" />
          <Text variant="body" color="textMuted" align="center">
            {t('partner.ops_ob_done_body')}
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      edges={['bottom']}
      testID={`ops-onboard-${step}`}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
          {index > 0 ? <Button label={t('action.back')} variant="secondary" size="lg" onPress={() => setIndex(index - 1)} /> : null}
          <Button
            testID="ops-onboard-next"
            label={last ? t('partner.ops_ob_submit') : t('action.next')}
            size="lg"
            style={{ flex: 1 }}
            disabled={!stepReady(step, d)}
            loading={submit.isPending}
            onPress={() => void next()}
          />
        </View>
      }
    >
      <Stack.Screen options={{ title: t('partner.ops_ob_title') }} />
      <View style={{ gap: theme.space[2] }}>
        <StepBar total={ONBOARD_STEPS.length} index={index} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text variant="heading">{t(STEP_KEY[step])}</Text>
          <Text variant="caption" color="textMuted" tabular>
            {t('partner.ops_ob_step', { n: index + 1, total: ONBOARD_STEPS.length })}
          </Text>
        </View>
      </View>

      {step === 'shop' ? <ShopStep d={d} patch={patch} /> : null}
      {step === 'contact' ? <ContactStep d={d} patch={patch} /> : null}
      {step === 'location' ? <LocationStep d={d} patch={patch} /> : null}
      {step === 'location' ? <DoorPhoto d={d} setD={setD} /> : null}
      {step === 'menu' ? <MenuStep d={d} setD={setD} /> : null}
      {step === 'settle' ? <SettleStep d={d} patch={patch} /> : null}
      {step === 'review' ? <ReviewStep d={d} goTo={(s) => setIndex(ONBOARD_STEPS.indexOf(s))} /> : null}
    </Screen>
  );
}

type StepProps = { d: OnboardDraft; patch: (p: Partial<OnboardDraft>) => void };

function ShopStep({ d, patch }: StepProps) {
  const theme = useTheme();
  const t = useT();
  return (
    <>
      <TextField testID="ops-onboard-name" label={t('partner.ops_ob_name')} hint={t('partner.ops_ob_name_hint')} placeholder="مطعم الريف" value={d.name} onChangeText={(name) => patch({ name })} maxLength={80} />
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label">{t('partner.ops_ob_category')}</Text>
        <ChoiceCard testID="ops-onboard-type-restaurant" icon="bag" title={t('partner.ops_ob_restaurant')} subtitle={t('partner.ops_ob_restaurant_sub')} selected={d.type === 'restaurant'} onPress={() => patch({ type: 'restaurant' })} />
        <ChoiceCard testID="ops-onboard-type-grocer" icon="cart" title={t('partner.ops_ob_grocer')} subtitle={t('partner.ops_ob_grocer_sub')} selected={d.type === 'grocer'} onPress={() => patch({ type: 'grocer' })} />
      </View>
    </>
  );
}

function ContactStep({ d, patch }: StepProps) {
  const theme = useTheme();
  const t = useT();
  const [touched, setTouched] = useState(false);
  const bad = touched && d.contactPhone.length > 0 && !normalizeIraqiPhone(d.contactPhone);
  return (
    <>
      <TextField testID="ops-onboard-contact-name" label={t('partner.ops_ob_contact_name')} leadingIcon="user" value={d.contactName} onChangeText={(contactName) => patch({ contactName })} maxLength={60} />
      <TextField
        testID="ops-onboard-contact-phone"
        label={t('partner.ops_ob_contact_phone')}
        leadingIcon="phone"
        placeholder={t('onboarding.phone_placeholder')}
        keyboardType="phone-pad"
        value={d.contactPhone}
        onChangeText={(v) => patch({ contactPhone: formatPhoneInput(v) })}
        onBlur={() => setTouched(true)}
        error={bad ? t('error.phone_invalid') : undefined}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name="shield" size={16} color="successText" />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('partner.ops_ob_contact_hint')}
        </Text>
      </View>
    </>
  );
}

function LocationStep({ d, patch }: StepProps) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const zones = useMemo(() => zoneOptions(locale), [locale]);
  const [locating, setLocating] = useState(false);
  const zone = zones.find((z) => z.id === d.zoneKey);
  const at = d.pin ?? zone?.centre ?? null;
  const pins = useMemo(() => (at ? [{ at, kind: 'pickup' as const, label: d.name.trim() || t('partner.ops_ob_s_shop') }] : []), [at, d.name, t]);

  const here = async () => {
    setLocating(true);
    const fix = await currentFix();
    setLocating(false);
    if (!fix) return toast.show({ tone: 'warning', message: t('error.location_weak') });
    const pin = { lat: fix.lat, lng: fix.lng };
    const z = nearestZone(pin);
    if (!z) return toast.show({ tone: 'warning', message: t('error.outside_zone') });
    patch({ pin, zoneKey: z });
  };

  return (
    <>
      <View style={{ height: 220, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }} testID="ops-onboard-map">
        <DriverMap self={null} vehicleIcon="bag" online={false} pins={pins} soloZoom={d.pin ? 15 : 14.4} />
      </View>
      <Button testID="ops-onboard-here" label={t('partner.ops_ob_here')} icon="location-arrow" variant="secondary" fullWidth loading={locating} onPress={() => void here()} />
      <Text variant="footnote" color={d.pin ? 'successText' : 'textMuted'} tabular>
        {d.pin ? t('partner.ops_ob_pin_gps') : t('partner.ops_ob_pin_zone')}
      </Text>
      <View style={{ gap: theme.space[2] }}>
        <Text variant="label">{t('partner.ops_ob_zone')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {zones.map((z) => (
            <Chip key={z.id} testID={`ops-onboard-zone-${z.id}`} role="radio" selected={d.zoneKey === z.id} label={z.name} onPress={() => patch({ zoneKey: z.id, pin: d.zoneKey === z.id ? d.pin : null })} />
          ))}
        </View>
      </View>
    </>
  );
}

function MenuStep({ d, setD }: { d: OnboardDraft; setD: Dispatch<SetStateAction<OnboardDraft>> }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const client = useApiClient();
  const count = d.menuPhotos.length;

  const send = async (p: PickedPhoto) => {
    setD((x) => ({ ...x, menuPhotos: x.menuPhotos.map((m) => (m.uri === p.uri ? { ...m, failed: false } : m)) }));
    try {
      const id = await uploadPhoto(p, (input) => client.places.photoUpload.mutate(input));
      setD((x) => ({ ...x, menuPhotos: x.menuPhotos.map((m) => (m.uri === p.uri ? { ...m, uploadId: id, failed: false } : m)) }));
    } catch {
      // f8: a page that didn't send stays, marked, to send again with one tap (the street network drops).
      setD((x) => ({ ...x, menuPhotos: x.menuPhotos.map((m) => (m.uri === p.uri ? { ...m, failed: true } : m)) }));
    }
  };

  const add = async (source: 'camera' | 'library') => {
    const res = await pickPhotos(source, true);
    if (res === 'denied') return toast.show({ tone: 'warning', message: t('error.camera_denied') });
    if (res.length === 0) return;
    setD((x) => ({ ...x, menuPhotos: [...x.menuPhotos, ...res.map((p) => ({ uri: p.uri, uploadId: null, file: p }))].slice(0, 30) }));
    for (const p of res) await send(p);
  };
  const failed = failedCount(d.menuPhotos);

  return (
    <>
      <Text variant="body" color="textMuted">
        {t('partner.ops_ob_menu_hint')}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }} testID="ops-onboard-photos">
        {d.menuPhotos.map((p, i) => (
          <View key={p.uri} style={{ width: '31.6%', aspectRatio: 3 / 4, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
            <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            {p.failed ? (
              <Pressable
                testID={`ops-onboard-photo-retry-${i}`}
                accessibilityRole="button"
                accessibilityLabel={t('partner.f8_photo_retry')}
                onPress={() => p.file && void send(p.file)}
                style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: withAlpha(theme.colors.danger, 0.78), alignItems: 'center', justifyContent: 'center', gap: 6, padding: theme.space[2] }}
              >
                <Icon name="refresh" size={22} color="onDanger" strokeWidth={2.4} />
                <Text variant="caption" weight={700} color="onDanger" align="center">
                  {t('partner.f8_photo_retry')}
                </Text>
              </Pressable>
            ) : p.uploadId ? null : (
              <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={color.neutral[0]} />
              </View>
            )}
            <View style={{ position: 'absolute', bottom: 6, start: 6, backgroundColor: withAlpha(color.neutral[900], 0.72), borderRadius: 10, minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
              <Text variant="caption" weight={700} tabular style={{ color: color.neutral[0], lineHeight: 18 }}>
                {i + 1}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('partner.ops_remove_photo')}
              onPress={() => setD((x) => ({ ...x, menuPhotos: x.menuPhotos.filter((m) => m.uri !== p.uri) }))}
              hitSlop={8}
              style={{ position: 'absolute', top: 6, end: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="x" size={14} color="text" strokeWidth={2.6} />
            </Pressable>
          </View>
        ))}
        <Pressable
          testID="ops-onboard-add-photo"
          accessibilityRole="button"
          onPress={() => void add('camera')}
          style={{ width: '31.6%', aspectRatio: 3 / 4, borderRadius: theme.radius.md, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: theme.colors.surface }}
        >
          <CameraGlyph size={28} color="accentText" />
          <Text variant="caption" weight={600} color="accentText">
            {t('partner.ops_ob_menu_add')}
          </Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="label" weight={600} tabular>
          {t(photosKey(count), { n: count })}
        </Text>
        <Button label={t('partner.ops_from_library')} variant="ghost" size="sm" onPress={() => void add('library')} />
      </View>
      {failed > 0 ? (
        <View testID="ops-onboard-photos-failed" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Icon name="wifi-off" size={16} color="dangerText" />
          <Text variant="footnote" color="dangerText" style={{ flex: 1 }}>
            {t(failed === 1 ? 'partner.f8_photos_failed_one' : 'partner.f8_photos_failed_many')}
          </Text>
        </View>
      ) : null}
      {count === 0 ? (
        <Text variant="footnote" color="textMuted">
          {t('partner.ops_ob_menu_skip')}
        </Text>
      ) : null}
    </>
  );
}

/**
 * f8: the shop door, with a landmark beside it if there is one — couriers find the shop by it (sent
 * as the onboarding's shop photo). Taking, sending, sent, and didn't send (kept, one tap to retry).
 */
function DoorPhoto({ d, setD }: { d: OnboardDraft; setD: Dispatch<SetStateAction<OnboardDraft>> }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const client = useApiClient();
  const door = d.shopPhoto;

  const send = async (p: PickedPhoto) => {
    setD((x) => ({ ...x, shopPhoto: { uri: p.uri, uploadId: null, failed: false, file: p } }));
    try {
      const id = await uploadPhoto(p, (input) => client.places.photoUpload.mutate(input));
      setD((x) => (x.shopPhoto?.uri === p.uri ? { ...x, shopPhoto: { ...x.shopPhoto, uploadId: id, failed: false } } : x));
    } catch {
      setD((x) => (x.shopPhoto?.uri === p.uri ? { ...x, shopPhoto: { ...x.shopPhoto, failed: true } } : x));
    }
  };
  const take = async () => {
    const res = await pickPhotos('camera');
    if (res === 'denied') return toast.show({ tone: 'warning', message: t('error.camera_denied') });
    if (res[0]) await send(res[0]);
  };

  const state = !door ? 'empty' : door.failed ? 'failed' : door.uploadId ? 'sent' : 'sending';
  return (
    <View testID="ops-onboard-door" style={{ gap: theme.space[2] }}>
      <Text variant="label">{t('partner.f8_door_title')}</Text>
      <Text variant="footnote" color="textMuted">
        {t('partner.f8_door_hint')}
      </Text>
      {door ? (
        <View testID={`ops-onboard-door-${state}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[2], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: state === 'failed' ? theme.colors.danger : theme.colors.border, backgroundColor: theme.colors.surface }}>
          <View style={{ width: 88, height: 66, borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors.surfaceSunken }}>
            <Image source={{ uri: door.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            {state === 'sending' ? (
              <View style={{ position: 'absolute', top: 0, bottom: 0, start: 0, end: 0, backgroundColor: theme.colors.scrim, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color={color.neutral[0]} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {state === 'sent' ? <Icon name="check" size={16} color="successText" strokeWidth={2.6} /> : state === 'failed' ? <Icon name="wifi-off" size={16} color="dangerText" /> : null}
              <Text variant="label" weight={600} color={state === 'sent' ? 'successText' : state === 'failed' ? 'dangerText' : 'textMuted'}>
                {t(state === 'sent' ? 'partner.f8_door_sent' : state === 'failed' ? 'partner.f8_door_failed' : 'partner.f8_door_sending')}
              </Text>
            </View>
          </View>
          {state === 'failed' ? (
            <Button testID="ops-onboard-door-retry" label={t('partner.f8_door_retry')} icon="refresh" size="sm" style={{ alignSelf: 'center' }} onPress={() => door.file && void send(door.file)} />
          ) : state === 'sent' ? (
            <Button testID="ops-onboard-door-change" label={t('partner.f8_door_change')} variant="ghost" size="sm" style={{ alignSelf: 'center' }} onPress={() => void take()} />
          ) : null}
        </View>
      ) : (
        <Pressable
          testID="ops-onboard-door-add"
          accessibilityRole="button"
          onPress={() => void take()}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.space[2], minHeight: 64, borderRadius: theme.radius.lg, borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.surface, transform: [{ scale: pressed ? 0.985 : 1 }] })}
        >
          <CameraGlyph size={24} color="accentText" />
          <Text variant="label" weight={600} color="accentText">
            {t('partner.f8_door_add')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function SettleStep({ d, patch }: StepProps) {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="body" color="textMuted">
        {t('partner.ops_ob_settle_q')}
      </Text>
      {SETTLEMENT_MODES.map((m) => (
        <ChoiceCard
          key={m}
          testID={`ops-onboard-settle-${m}`}
          icon={m === 'nightly_courier' ? 'bike' : m === 'on_demand' ? 'bell' : m === 'daily_zaincash' ? 'wallet' : 'receipt'}
          title={t(SETTLE_KEY[m].title)}
          subtitle={t(SETTLE_KEY[m].sub)}
          tag={m === DEFAULT_SETTLEMENT ? t('partner.ops_ob_settle_default') : undefined}
          selected={d.settlementMode === m}
          onPress={() => patch({ settlementMode: m })}
        />
      ))}
      <TextField label={t('partner.ops_ob_notes')} placeholder={t('partner.ops_ob_notes_hint')} value={d.notes} onChangeText={(notes) => patch({ notes })} multiline maxLength={500} />
    </View>
  );
}

function ReviewStep({ d, goTo }: { d: OnboardDraft; goTo: (s: OnboardStep) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const zone = zoneOptions(locale).find((z) => z.id === d.zoneKey);
  const phone = normalizeIraqiPhone(d.contactPhone);
  const sections: Array<{ step: OnboardStep; icon: 'bag' | 'user' | 'map-pin' | 'receipt' | 'wallet'; title: string; lines: string[] }> = [
    { step: 'shop', icon: 'bag', title: d.name.trim(), lines: [d.type === 'restaurant' ? t('partner.ops_ob_restaurant') : t('partner.ops_ob_grocer')] },
    { step: 'contact', icon: 'user', title: d.contactName.trim(), lines: [phone ? `⁦${displayPhone(phone)}⁩` : ''] },
    { step: 'location', icon: 'map-pin', title: zone?.name ?? '—', lines: [d.pin ? t('partner.ops_ob_pinned') : t('partner.ops_ob_zone_only'), d.shopPhoto?.uploadId ? t('partner.f8_door_review') : t('partner.f8_door_none')] },
    { step: 'menu', icon: 'receipt', title: t(photosKey(d.menuPhotos.length), { n: d.menuPhotos.length }), lines: [] },
    { step: 'settle', icon: 'wallet', title: t(SETTLE_KEY[d.settlementMode].title), lines: d.notes.trim() ? [d.notes.trim()] : [] },
  ];
  return (
    <Card elevation={1} padding={0} testID="ops-onboard-review">
      {sections.map((s, i) => (
        <View key={s.step} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], borderBottomWidth: i < sections.length - 1 ? 1 : 0, borderBottomColor: theme.colors.border }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={s.icon} size={20} color="text" />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="caption" color="textMuted">
              {t(STEP_KEY[s.step])}
            </Text>
            <Text variant="bodyStrong" numberOfLines={1}>
              {s.title}
            </Text>
            {s.lines.filter(Boolean).map((l) => (
              <Text key={l} variant="footnote" color="textMuted" numberOfLines={2} tabular>
                {l}
              </Text>
            ))}
          </View>
          <Pressable accessibilityRole="button" onPress={() => goTo(s.step)} hitSlop={8}>
            <Text variant="label" weight={600} color="accentText">
              {t('partner.ops_ob_edit')}
            </Text>
          </Pressable>
        </View>
      ))}
    </Card>
  );
}
