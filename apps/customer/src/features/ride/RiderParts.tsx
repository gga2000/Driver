import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RIDE_RIDER_NAME_MAX } from '@driver/contracts';
import { Button, ChipGroup, Icon, Text, TextField, useTheme } from '@driver/ui';
import { BottomPanel } from '@/features/track/Panels';
import { useT } from '@/lib/i18n';
import { displayPhone, formatPhoneInput } from '@/lib/phone';
import { riderChipId, riderName, typedRider, type RiderOption, type RiderPick, type TypedRiderError } from './rider';

/**
 * «لمنو المشوار؟» on the choose screen (ride ideas c9/s3): one calm row under the vehicles — «إلي» by
 * default, «لـ ماما» once he picked someone — that opens the sheet.
 */
export function RiderRow({ pick, onPress }: { pick: RiderPick; onPress: () => void }) {
  const theme = useTheme();
  const t = useT();
  const name = riderName(pick);
  const value = name ? t('ride.rider_for', { name }) : t('ride.rider_me');
  return (
    <Pressable
      testID="ride-rider"
      accessibilityRole="button"
      accessibilityLabel={`${t('ride.rider_title')} ${value}`}
      onPress={() => {
        theme.haptic('selection');
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[2],
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        backgroundColor: pressed ? theme.colors.accentTint : name ? theme.colors.liveTint : theme.colors.surfaceSunken,
      })}
    >
      <Icon name="user" size={18} color={name ? 'liveText' : 'text'} strokeWidth={2} />
      <Text variant="label" color="textMuted" numberOfLines={1}>
        {t('ride.rider_title')}
      </Text>
      <View style={{ flex: 1 }} />
      <Text variant="label" weight={700} color={name ? 'liveText' : 'text'} numberOfLines={1} style={{ flexShrink: 1 }} testID="ride-rider-value">
        {value}
      </Text>
      <Icon name="chevron-down" size={18} color="textMuted" strokeWidth={2.2} />
    </Pressable>
  );
}

/**
 * The sheet: «إلي», the people he booked for before, his trusted people and his household, or «شخص
 * ثاني» with a name and an Iraqi mobile number (checked like every number in the app). «تمام» keeps the
 * choice; a typed person with a missing name or a wrong number stays open with the field to fix.
 */
export function RiderSheet({ pick, options, onPick, onClose }: { pick: RiderPick; options: readonly RiderOption[]; onPick: (pick: RiderPick) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [chip, setChip] = useState(() => riderChipId(pick));
  const [name, setName] = useState(pick.kind === 'typed' ? pick.name : '');
  const [phone, setPhone] = useState(pick.kind === 'typed' ? displayPhone(pick.phone) : '');
  const [errors, setErrors] = useState<TypedRiderError[]>([]);
  const items = [
    { id: 'me', label: t('ride.rider_me'), avatar: { icon: 'user' as const, tone: 'accent' as const } },
    ...options.map((o) => ({ id: o.id, label: o.name, avatar: { name: o.name } })),
    { id: 'other', label: t('ride.rider_someone'), avatar: { icon: 'plus' as const, tone: 'info' as const } },
  ];

  const done = () => {
    if (chip === 'me') return onPick({ kind: 'me' });
    if (chip !== 'other') {
      const o = options.find((x) => x.id === chip);
      return onPick(o ? o.pick : { kind: 'me' });
    }
    const typed = typedRider(name, phone);
    if ('errors' in typed) {
      theme.haptic('error');
      return setErrors(typed.errors);
    }
    onPick(typed.pick);
  };

  return (
    <BottomPanel onClose={onClose} testID="ride-rider-sheet">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="heading">{t('ride.rider_title')}</Text>
        <ChipGroup
          accessibilityLabel={t('ride.rider_title')}
          mode="single"
          required
          items={items}
          value={[chip]}
          onChange={(next) => {
            setChip(next[0] ?? 'me');
            setErrors([]);
          }}
        />
        {chip === 'other' ? (
          <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(200)} style={{ gap: theme.space[2] }}>
            <TextField
              testID="ride-rider-name"
              value={name}
              onChangeText={(v) => {
                setName(v);
                setErrors((e) => e.filter((x) => x !== 'name'));
              }}
              placeholder={t('ride.rider_name')}
              leadingIcon="user"
              maxLength={RIDE_RIDER_NAME_MAX}
              autoComplete="name"
              {...(errors.includes('name') ? { error: t('item.person_name_required') } : {})}
            />
            <TextField
              testID="ride-rider-phone"
              value={phone}
              onChangeText={(v) => {
                setPhone(formatPhoneInput(v));
                setErrors((e) => e.filter((x) => x !== 'phone'));
              }}
              placeholder={t('ride.rider_phone')}
              leadingIcon="phone"
              keyboardType="phone-pad"
              autoComplete="tel"
              {...(errors.includes('phone') ? { error: t('error.phone_invalid') } : {})}
            />
          </Animated.View>
        ) : null}
        {chip !== 'me' ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }} testID="ride-rider-hint">
            <Icon name="phone" size={15} color="textMuted" strokeWidth={2} />
            <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
              {t('ride.rider_hint')}
            </Text>
          </View>
        ) : null}
      </ScrollView>
      <Button label={t('action.done')} fullWidth onPress={done} testID="ride-rider-done" />
    </BottomPanel>
  );
}

/**
 * Ride idea s3 on the booker's live screen: he follows his mother's ride on his own phone. Says that the
 * link went to her number and the driver calls her, from the search until she arrives.
 */
export function RiderFollowCard({ name }: { name: string }) {
  const theme = useTheme();
  const t = useT();
  return (
    <Animated.View
      testID="ride-follow"
      entering={theme.reduceMotion ? undefined : FadeInDown.duration(240)}
      style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.liveTint }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface }}>
        <Icon name="family" size={20} color="liveText" strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" color="liveText">
          {t('ride.follow_title', { name })}
        </Text>
        <Text variant="footnote" color="textMuted">
          {t('ride.follow_body', { name })}
        </Text>
      </View>
    </Animated.View>
  );
}
