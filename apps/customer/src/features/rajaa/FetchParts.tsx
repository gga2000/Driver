import { Pressable, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { RIDE_RIDER_NAME_MAX, type RequestTripKind } from '@driver/contracts';
import type { MessageKey } from '@driver/i18n';
import { ChipGroup, Icon, Text, TextField, useTheme, type IconName } from '@driver/ui';
import type { RiderOption, TypedRiderError } from '@/features/ride/rider';
import { useT } from '@/lib/i18n';
import { formatPhoneInput } from '@/lib/phone';
import { FETCH_TYPED } from './fetch';

const KIND_ICON: Record<RequestTripKind, IconName> = { one_way: 'location-arrow', wait_return: 'clock', two_days: 'swap', fetch: 'user' };

/**
 * k1: the four kinds of private trip side by side, two by two — «بس رايح», «يستناك وترجع», «ترجع يوم
 * ثاني», «جيب واحد» — each with one line saying what it means. A radio group; the picked card is lit.
 */
export function TripKindCards({ kinds, value, onChange }: { kinds: readonly RequestTripKind[]; value: RequestTripKind; onChange: (v: RequestTripKind) => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('rajaa.req_trip_a11y')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
      {kinds.map((k) => {
        const on = k === value;
        return (
          <Pressable
            key={k}
            testID={`req-trip-${k}`}
            accessibilityRole="radio"
            aria-checked={on}
            accessibilityLabel={`${t(`rajaa.req_trip.${k}` as MessageKey)}، ${t(`rajaa.req_trip_detail.${k}` as MessageKey)}`}
            onPress={() => {
              theme.haptic('selection');
              onChange(k);
            }}
            style={({ pressed }) => ({
              flexBasis: '47%',
              flexGrow: 1,
              minHeight: 88,
              padding: theme.space[3],
              gap: theme.space[1],
              borderRadius: theme.radius.lg,
              borderWidth: on ? 1.5 : 1,
              borderColor: on ? theme.colors.accent : theme.colors.border,
              backgroundColor: on ? theme.colors.accentTint : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            })}
          >
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: theme.radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? theme.colors.accent : theme.colors.surfaceSunken,
              }}
            >
              <Icon name={KIND_ICON[k]} size={17} color={on ? 'onAccent' : 'accentText'} strokeWidth={2.2} />
            </View>
            <Text variant="label" weight={700}>
              {t(`rajaa.req_trip.${k}` as MessageKey)}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t(`rajaa.req_trip_detail.${k}` as MessageKey)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * k2 «منو تجيب؟»: his trusted people and household as chips, then «شخص ثاني» with a name (what he calls
 * them, «ماما») and an Iraqi mobile number. The line under it says what the driver will see and do.
 */
export function FetchWho({
  options,
  chip,
  onChip,
  name,
  onName,
  phone,
  onPhone,
  errors,
}: {
  options: readonly RiderOption[];
  chip: string | null;
  onChip: (id: string) => void;
  name: string;
  onName: (v: string) => void;
  phone: string;
  onPhone: (v: string) => void;
  errors: readonly TypedRiderError[];
}) {
  const theme = useTheme();
  const t = useT();
  const items = [
    ...options.map((o) => ({ id: o.id, label: o.name, avatar: { name: o.name } })),
    { id: FETCH_TYPED, label: t('rajaa.req_fetch_someone'), avatar: { icon: 'plus' as const, tone: 'info' as const } },
  ];
  return (
    <View style={{ gap: theme.space[3] }} testID="req-fetch-who">
      <ChipGroup accessibilityLabel={t('rajaa.req_fetch_who_q')} mode="single" required items={items} value={chip ? [chip] : []} onChange={(next) => next[0] && onChip(next[0])} />
      {chip === FETCH_TYPED ? (
        <Animated.View entering={theme.reduceMotion ? undefined : FadeInDown.duration(200)} style={{ gap: theme.space[2] }}>
          <TextField
            testID="req-fetch-name"
            value={name}
            onChangeText={onName}
            placeholder={t('rajaa.req_fetch_name')}
            leadingIcon="user"
            maxLength={RIDE_RIDER_NAME_MAX}
            {...(errors.includes('name') ? { error: t('item.person_name_required') } : {})}
          />
          <TextField
            testID="req-fetch-phone"
            value={phone}
            onChangeText={(v) => onPhone(formatPhoneInput(v))}
            placeholder={t('rajaa.req_fetch_phone')}
            leadingIcon="phone"
            keyboardType="phone-pad"
            autoComplete="tel"
            {...(errors.includes('phone') ? { error: t('error.phone_invalid') } : {})}
          />
        </Animated.View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
        <Icon name="phone" size={15} color="textMuted" strokeWidth={2} />
        <Text variant="footnote" color="textMuted" style={{ flex: 1 }}>
          {t('rajaa.req_fetch_hint')}
        </Text>
      </View>
    </View>
  );
}
