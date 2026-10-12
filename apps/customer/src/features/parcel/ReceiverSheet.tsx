import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RIDE_RIDER_NAME_MAX, type RideRiderInput } from '@driver/contracts';
import { Button, ChipGroup, Icon, Text, TextField, useTheme } from '@driver/ui';
import { FETCH_TYPED, fetchPick, fetchRiderInput, type FetchPick } from '@/features/rajaa/fetch';
import type { RiderOption, TypedRiderError } from '@/features/ride/rider';
import { BottomPanel } from '@/features/track/Panels';
import { useT } from '@/lib/i18n';
import { displayPhone, formatPhoneInput } from '@/lib/phone';

/** Who the parcel is for: one of his trusted people, someone in his household, or a name and number typed now. */
export type ReceiverPick = FetchPick;

export function receiverInput(pick: ReceiverPick): RideRiderInput {
  return fetchRiderInput(pick);
}

function chipOf(pick: ReceiverPick | null): string | null {
  if (!pick) return null;
  if (pick.kind === 'typed') return FETCH_TYPED;
  return pick.kind === 'trusted' ? `trusted:${pick.index}` : `household:${pick.personId}`;
}

/**
 * «لمنو الطرد؟» — the ride's «لمنو المشوار؟» people (ride ideas c9/s3; `features/ride/rider`), without «إلي»
 * (he isn't sending it to himself) and without earlier taxi riders (the server takes only these three for a
 * parcel). A typed person is checked like every number in the app; «تمام» keeps the choice.
 */
export function ReceiverSheet({ pick, options, onPick, onClose }: { pick: ReceiverPick | null; options: readonly RiderOption[]; onPick: (pick: ReceiverPick) => void; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  const offered = options.filter((o) => o.pick.kind !== 'recent');
  const [chip, setChip] = useState<string>(() => chipOf(pick) ?? offered[0]?.id ?? FETCH_TYPED);
  const [name, setName] = useState(pick?.kind === 'typed' ? pick.name : '');
  const [phone, setPhone] = useState(pick?.kind === 'typed' ? displayPhone(pick.phone) : '');
  const [errors, setErrors] = useState<TypedRiderError[]>([]);
  const items = [
    ...offered.map((o) => ({ id: o.id, label: o.name, avatar: { name: o.name } })),
    { id: FETCH_TYPED, label: t('ride.rider_someone'), avatar: { icon: 'plus' as const, tone: 'info' as const } },
  ];

  const done = () => {
    const r = fetchPick(chip, offered, name, phone);
    if (!r) return;
    if ('errors' in r) {
      theme.haptic('error');
      return setErrors(r.errors);
    }
    onPick(r.pick);
  };

  return (
    <BottomPanel onClose={onClose} testID="parcel-receiver-sheet">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ gap: theme.space[4] }}>
        <Text variant="heading">{t('parcel.c_for_title')}</Text>
        <ChipGroup
          accessibilityLabel={t('parcel.c_for_title')}
          mode="single"
          required
          items={items}
          value={[chip]}
          onChange={(next) => {
            setChip(next[0] ?? FETCH_TYPED);
            setErrors([]);
          }}
        />
        {chip === FETCH_TYPED ? (
          <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(200)} style={{ gap: theme.space[2] }}>
            <TextField
              testID="parcel-receiver-name"
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
              testID="parcel-receiver-phone"
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
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
          <Icon name="chat" size={15} color="textMuted" strokeWidth={2} />
          <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
            {t('parcel.c_for_hint')}
          </Text>
        </View>
      </ScrollView>
      <Button label={t('action.done')} fullWidth onPress={done} testID="parcel-receiver-done" />
    </BottomPanel>
  );
}
