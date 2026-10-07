import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { GarageTaxiPayment, GarageTaxiPlace } from '@driver/contracts';
import { Button, Card, ChipGroup, Icon, Skeleton, StatusPill, Text, useTheme, type IconName, type StatusTone } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { publicPlaceName } from '@/features/rajaa/logic';

/**
 * The frame the الرجعة taxi cards share (taxi ideas x2 and x4): a resting card with the icon tile,
 * the title and an optional pill, then the body. Drop-in: no screen around it is assumed.
 */
export function TaxiCardShell({ icon, title, pill, tone = 'surface', children, testID }: { icon: IconName; title: string; pill?: { label: string; tone: StatusTone; icon?: IconName }; tone?: 'surface' | 'tint'; children?: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <Card testID={testID} tone={tone} padding={4} style={{ gap: theme.space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'tint' ? theme.colors.surface : theme.colors.accentTint }}>
          <Icon name={icon} size={22} color="accentText" strokeWidth={2} />
        </View>
        <Text variant="bodyStrong" style={{ flex: 1 }}>
          {title}
        </Text>
        {pill ? <StatusPill size="sm" tone={pill.tone} icon={pill.icon} label={pill.label} /> : null}
      </View>
      {children}
    </Card>
  );
}

/** Loading, offline and the error with its retry: the card keeps its place and says what is going on. */
export function TaxiCardWaiting({ kind, title, icon, onRetry, testID }: { kind: 'loading' | 'error' | 'offline'; title: string; icon: IconName; onRetry?: () => void; testID?: string }) {
  const theme = useTheme();
  const t = useT();
  if (kind === 'loading') {
    return (
      <TaxiCardShell icon={icon} title={title} testID={testID}>
        <View accessibilityRole="progressbar" accessibilityLabel={title} style={{ gap: theme.space[2] }}>
          <Skeleton width="85%" height={16} />
          <Skeleton width="55%" height={14} />
          <Skeleton width="100%" height={48} radius={theme.radius.lg} />
        </View>
      </TaxiCardShell>
    );
  }
  return (
    <TaxiCardShell icon={icon} title={title} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <Icon name={kind === 'offline' ? 'wifi-off' : 'refresh'} size={18} color="textMuted" />
        <Text variant="body" color="textMuted" style={{ flex: 1 }}>
          {t(kind === 'offline' ? 'gtaxi.offline' : 'gtaxi.load_error')}
        </Text>
      </View>
      {kind === 'error' && onRetry ? <Button testID={testID ? `${testID}-retry` : undefined} variant="secondary" icon="refresh" label={t('gtaxi.retry')} fullWidth onPress={onRetry} /> : null}
    </TaxiCardShell>
  );
}

/** His saved places as one-tap chips (home first): where the taxi starts (x2) or takes him (x4). */
export function PlaceChoice({ label, places, value, onChange, disabled }: { label: string; places: readonly GarageTaxiPlace[]; value: string | null; onChange: (id: string) => void; disabled?: boolean }) {
  const theme = useTheme();
  if (places.length < 2) return null;
  return (
    <View style={{ gap: theme.space[1], opacity: disabled ? theme.state.disabledOpacity : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      <ChipGroup
        accessibilityLabel={label}
        items={places.map((p) => ({ id: p.id, label: p.name, icon: p.label === 'home' ? 'home' : p.label === 'work' ? 'briefcase' : 'map-pin' }))}
        value={value ? [value] : []}
        required
        onChange={(next) => {
          const id = next[0];
          if (id && id !== value) onChange(id);
        }}
      />
    </View>
  );
}

export function payLabel(t: ReturnType<typeof useT>, payment: GarageTaxiPayment): string {
  return t(payment === 'wallet' ? 'gtaxi.pay_wallet' : 'gtaxi.pay_cash');
}

/** A garage as riders know it («كراج البوابة 1», never the draft marker). */
export function garageLabel(nameAr: string): string {
  return publicPlaceName(nameAr);
}
