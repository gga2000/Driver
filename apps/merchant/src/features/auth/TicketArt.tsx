import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { StatusPill, Text, useTheme } from '@driver/ui';
import { useT } from '@/lib/i18n';

/** A static accept ring for the illustration (two thirds left). */
function MiniRing({ size = 56 }: { size?: number }) {
  const theme = useTheme();
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.surfaceSunken} strokeWidth={6} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={theme.colors.accent} strokeWidth={6} fill="none" strokeLinecap="round" strokeDasharray={`${c} ${c}`} strokeDashoffset={c * 0.33} />
      </Svg>
      <Text weight={700} tabular style={{ fontSize: 20, lineHeight: 28 }}>
        60
      </Text>
    </View>
  );
}

/**
 * Welcome illustration: the kitchen's day in two tickets — a new order with its accept ring on top,
 * one being prepared behind it, and the courier pill. Drawn with the real UI pieces, decorative only.
 */
export function TicketArt({ scale = 1 }: { scale?: number }) {
  const theme = useTheme();
  const t = useT();
  const card = {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    padding: theme.space[4],
    gap: theme.space[3],
    shadowColor: theme.colors.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  } as const;
  const line = (qty: number, name: string, note?: string) => (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: 'row', gap: theme.space[2], alignItems: 'baseline' }}>
        <Text variant="title" weight={700} color="accentText" tabular>{`${qty}×`}</Text>
        <Text variant="bodyStrong">{name}</Text>
      </View>
      {note ? (
        <View style={{ marginStart: 30, alignSelf: 'flex-start', backgroundColor: theme.colors.warningTint, borderRadius: 6, paddingHorizontal: 6 }}>
          <Text variant="caption" weight={700}>
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 300, height: 400, transform: [{ scale }] }}>
      <View style={[card, { position: 'absolute', top: 0, end: 0, width: 230, transform: [{ rotate: '5deg' }], opacity: 0.95 }]}>
        <Text weight={700} tabular style={{ fontSize: 26, lineHeight: 36 }}>
          {t('merchant.card.number', { number: '3127' })}
        </Text>
        <StatusPill tone="accent" icon="clock" label={t('merchant.card.ready_in', { minutes: 12 })} />
        <View style={{ height: 50 }} />
      </View>
      <View style={[card, { position: 'absolute', top: 112, start: 0, width: 260, transform: [{ rotate: '-4deg' }], borderWidth: 3, borderColor: theme.colors.accent }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text weight={700} tabular style={{ flex: 1, fontSize: 30, lineHeight: 40 }}>
            {t('merchant.card.number', { number: '4821' })}
          </Text>
          <MiniRing />
        </View>
        {line(2, t('merchant.welcome.art_item1'), t('merchant.welcome.art_note'))}
        {line(1, t('merchant.welcome.art_item2'))}
        {line(1, t('merchant.welcome.art_item3'))}
        <View style={{ height: 44, borderRadius: theme.radius.md, backgroundColor: theme.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="button" weight={700} style={{ color: theme.colors.onAccent }}>
            {t('merchant.accept')}
          </Text>
        </View>
      </View>
      <View style={{ position: 'absolute', bottom: -6, end: -12, transform: [{ rotate: '2deg' }] }}>
        <StatusPill tone="info" icon="bike" live label={t('merchant.courier.on_the_way', { minutes: 4 })} />
      </View>
    </View>
  );
}
