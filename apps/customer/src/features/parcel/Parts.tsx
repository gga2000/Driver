import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { color } from '@driver/design-tokens';
import { Icon, PhotoImage, Text, useTheme, withAlpha, type IconName } from '@driver/ui';
import { apiPhoto } from '@/lib/photo';
import { parcelSwatch } from './palette';

/** The round surface button on the parcel screens (back, close), 52 px, as in the concepts. */
export function RoundButton({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        shadowColor: color.neutral[1000],
        shadowOpacity: theme.scheme === 'dark' ? 0 : 0.08,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: 2,
      })}
    >
      <Icon name={icon} size={22} color="text" strokeWidth={2.2} />
    </Pressable>
  );
}

/** The parcel screens' top bar: the round back button at the start, the title, and an optional chip at the end. */
export function TopBar({ title, onBack, backIcon = 'arrow-back', backLabel, end }: { title: string; onBack: () => void; backIcon?: IconName; backLabel: string; end?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: 56 }}>
      <RoundButton icon={backIcon} label={backLabel} onPress={onBack} testID="parcel-back" />
      <Text variant="heading" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
        {title}
      </Text>
      {end}
    </View>
  );
}

/** A small henna-washed chip (status, «يطلع هسة»). */
export function WashChip({ icon, label, testID }: { icon?: IconName; label: string; testID?: string }) {
  const theme = useTheme();
  const sw = parcelSwatch(theme);
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1], paddingHorizontal: theme.space[3], minHeight: 36, borderRadius: theme.radius.pill, backgroundColor: sw.wash }}>
      {icon ? <Icon name={icon} size={16} color={sw.text} strokeWidth={2.2} /> : null}
      <Text variant="label" weight={700} color={sw.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** A section's question above its control («لمنو؟», «وين نوصله؟»). */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="label" weight={600} color="textMuted">
      {children}
    </Text>
  );
}

/** One of two choices as a card with a radio (concept A1 «وين نوصله؟»): henna edge and wash when chosen. */
export function OptionCard({ title, sub, selected, onPress, children, testID }: { title: string; sub?: string; selected: boolean; onPress: () => void; children?: ReactNode; testID?: string }) {
  const theme = useTheme();
  const sw = parcelSwatch(theme);
  return (
    <View
      style={{
        borderRadius: theme.radius.xl,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? sw.fill : theme.colors.border,
        backgroundColor: selected ? sw.wash : theme.colors.surface,
        overflow: 'hidden',
      }}
    >
      <Pressable
        testID={testID}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={sub ? `${title}. ${sub}` : title}
        onPress={() => {
          theme.haptic('selection');
          onPress();
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4], minHeight: 56 }}
      >
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: selected ? sw.fill : theme.colors.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
          {selected ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: sw.fill }} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          {sub ? (
            <Text variant="footnote" color="textMuted">
              {sub}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {selected && children ? <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[4] }}>{children}</View> : null}
    </View>
  );
}

/** A photo the API returned (the parcel, the pickup, the door), or nothing. */
export function ApiPhoto({ url, style, label, testID }: { url: string | null; style: object; label: string; testID?: string }) {
  const uri = apiPhoto(url);
  if (!uri) return null;
  return <PhotoImage uri={uri} style={style} accessibilityLabel={label} testID={testID} eager />;
}

/** A photo card with its title and line under it (concept B1 «صورة الاستلام»). */
export function ProofPhoto({ url, title, sub, testID }: { url: string; title: string; sub: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ borderRadius: theme.radius['2xl'], overflow: 'hidden', backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border }}>
      <ApiPhoto url={url} label={title} style={{ width: '100%', aspectRatio: 16 / 10, backgroundColor: theme.colors.surfaceSunken }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[4] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="footnote" color="textMuted">
            {sub}
          </Text>
        </View>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.successTint }}>
          <Icon name="check" size={18} color="successText" strokeWidth={2.6} />
        </View>
      </View>
    </View>
  );
}

/** A soft note with an icon (the code's hint, the privacy line). */
export function Note({ icon, children, tone = 'muted', testID }: { icon: IconName; children: string; tone?: 'muted' | 'henna'; testID?: string }) {
  const theme = useTheme();
  const sw = parcelSwatch(theme);
  return (
    <View testID={testID} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: tone === 'henna' ? withAlpha(sw.fill, theme.scheme === 'dark' ? 0.18 : 0.08) : theme.colors.surfaceSunken }}>
      <Icon name={icon} size={18} color={tone === 'henna' ? sw.text : 'textMuted'} />
      <Text variant="footnote" color={tone === 'henna' ? 'text' : 'textMuted'} style={{ flex: 1 }}>
        {children}
      </Text>
    </View>
  );
}
