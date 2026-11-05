import type { ReactNode } from 'react';
import { View } from 'react-native';
import { contrastRatio, homeLook, type CustomerThemeName, type LiveStagePalette } from '@driver/design-tokens';
import { Button, Icon, ltr, Text, useTheme, type IconName } from '../src';

/**
 * The customer home redesign's colours (docs/specs/2026-11-01-home-redesign.md §4), shown only when
 * the gallery wears `sage` or `emeraldNight`. Swatches and colour samples, not the finished pieces:
 * those come one by one in step 3.
 */
export function HomeLookSection({ name }: { name: CustomerThemeName }) {
  const theme = useTheme();
  const look = homeLook[name];
  const night = name === 'emeraldNight';
  return (
    <View testID="home-look" style={{ width: '100%', marginBottom: theme.space[8], gap: theme.space[6] }}>
      <View style={{ gap: 2 }}>
        <Text variant="heading">{night ? 'ألوان الواجهة الجديدة: ليل زمردي' : 'ألوان الواجهة الجديدة: سيج'}</Text>
        <Text variant="footnote" color="textMuted" style={{ maxWidth: 560 }}>
          {night
            ? 'الزمردي للحي والمباشر، الزمردي الفاتح للأسعار والدقايق، والبرتقالي للأزرار. كل نسبة مكتوبة محسوبة.'
            : 'البرتقالي ما ينكتب على الخلفية الفاتحة: يا تعبئة بحبر غامق، يا كتابة على اللوحة الخضرة. كل نسبة مكتوبة محسوبة.'}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[5], alignItems: 'flex-start' }}>
        <OrderPanel name={name} />
        <View style={{ flex: 1, minWidth: 300, gap: theme.space[5] }}>
          <Symbols name={name} />
          <SearchSample name={name} />
          <View style={{ gap: theme.space[2] }}>
            <Button label="اطلب هسة" trailing="19,250 دينار" fullWidth />
            <Text variant="footnote" color="textMuted">
              {`حبر ${ltr(theme.colors.onAccent)} على البرتقالي ${ltr(theme.colors.accent)}: ${contrastRatio(theme.colors.onAccent, theme.colors.accent).toFixed(1)}:1. الأبيض عليه ${contrastRatio('#FFFFFF', theme.colors.accent).toFixed(1)}:1، ممنوع.`}
            </Text>
          </View>
        </View>
      </View>

      <Stages stages={theme.liveStages} />

      <View style={{ gap: theme.space[3] }}>
        <Text variant="title">النهر والخريطة</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
          <Chip hex={look.river.line} label="النهر" glow={look.river.glow} />
          <Chip hex={look.river.inner} label="داخل النهر" />
          <Chip hex={look.map.land} label="الأرض" />
          <Chip hex={look.map.blocks} label="البيوت" />
          <Chip hex={look.map.palms[0]} label="النخل" />
          <Chip hex={look.map.palms[1]} label="النخل الغامق" />
          <Chip hex={look.map.streets} label="الشوارع" />
          <Chip hex={look.live} label="المباشر" />
          <Chip hex={look.info} label="الأسعار والدقايق" />
        </View>
      </View>
    </View>
  );
}

function Chip({ hex, label, glow }: { hex: string; label: string; glow?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ width: 104, gap: theme.space[1] }}>
      <View style={{ height: 56, borderRadius: theme.radius.lg, backgroundColor: hex, borderWidth: 1, borderColor: theme.colors.border, boxShadow: glow ?? undefined }} />
      <Text variant="footnote" weight={600}>
        {label}
      </Text>
      <Text variant="footnote" color="textMuted" tabular>
        {ltr(hex)}
      </Text>
    </View>
  );
}

const STEPS = ['طلبت', 'دا يتحضّر', 'بالطريق', 'وصل'] as const;

/** The order panel: forest in sage, the raised surface at night; two steps done, «بالطريق» now, «وصل» to come. */
function OrderPanel({ name }: { name: CustomerThemeName }) {
  const theme = useTheme();
  const p = homeLook[name].panel;
  const now = 2;
  return (
    <View
      testID="home-look-panel"
      style={{ flex: 1, minWidth: 300, maxWidth: 420, backgroundColor: p.fill, borderRadius: 28, padding: theme.space[5], gap: theme.space[3], borderWidth: 1, borderColor: p.raised }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: homeLook[name].live }} />
        <Text variant="label" color={p.muted}>
          عندك طلب شغّال
        </Text>
      </View>
      <Text variant="title" color={p.on}>
        الدليفري بالطريق
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.space[2] }}>
        <Text variant="numeralMd" color={p.accent}>
          12
        </Text>
        <Text variant="title" color={p.onSoft}>
          دقيقة
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[1] }}>
        {STEPS.map((s, i) => (
          <View key={s} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: i <= now ? p.accent : p.raised }} />
        ))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {STEPS.map((s, i) => (
          <Text key={s} variant="footnote" weight={i === now ? 700 : 500} color={i <= now ? (i === now ? p.accent : p.on) : p.upcoming} style={{ flex: 1 }} align="center">
            {s}
          </Text>
        ))}
      </View>
      <View style={{ backgroundColor: p.raised, borderRadius: theme.radius.lg, padding: theme.space[3] }}>
        <Text variant="footnote" color={p.on}>
          {`«وصل» بلون ${ltr(p.upcoming)}: ${contrastRatio(p.upcoming, p.fill).toFixed(2)}:1 على اللوحة. البرتقالي على اللوحة ${contrastRatio(p.accent, p.fill).toFixed(1)}:1.`}
        </Text>
      </View>
    </View>
  );
}

const SYMBOLS: readonly { key: 'food' | 'taxi' | 'tuktuk' | 'parcel' | 'carts'; label: string; fact: string; icon: IconName }[] = [
  { key: 'food', label: 'أكل', fact: '34 مطعم', icon: 'food' },
  { key: 'taxi', label: 'تكسي', fact: '4 دقايق', icon: 'taxi' },
  { key: 'tuktuk', label: 'تكتك', fact: '3 دقايق', icon: 'tuktuk' },
  { key: 'parcel', label: 'طرود', fact: 'لأي باب', icon: 'parcel' },
  { key: 'carts', label: 'عربانات', fact: '5 فاتحة', icon: 'cart' },
];

/** Service symbols: filled with an ink outline in sage; rings at night, food a filled disc. */
function Symbols({ name }: { name: CustomerThemeName }) {
  const theme = useTheme();
  const look = homeLook[name];
  const night = name === 'emeraldNight';
  return (
    <View testID="home-look-symbols" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[4] }}>
      {SYMBOLS.map((s) => {
        const sw = theme.services[s.key];
        const filled = !night || s.key === 'food';
        const size = s.key === 'food' ? 64 : 52;
        return (
          <View key={s.key} style={{ alignItems: 'center', gap: theme.space[1], minWidth: 64 }}>
            <View
              style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: filled ? sw.fill : 'transparent',
                borderWidth: 2,
                borderColor: look.symbolOutline ?? sw.fill,
              }}
            >
              <Icon name={s.icon} size={s.key === 'food' ? 30 : 24} color={filled ? sw.on : sw.fill} strokeWidth={2} />
            </View>
            <Text variant="label" weight={700}>
              {s.label}
            </Text>
            <Text variant="footnote" color={look.info} tabular>
              {s.fact}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SearchSample({ name }: { name: CustomerThemeName }) {
  const theme = useTheme();
  const look = homeLook[name];
  return (
    <View
      testID="home-look-search"
      style={{ height: 52, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.space[4], gap: theme.space[2] }}
    >
      <Icon name="search" size={20} color={look.searchPlaceholder} />
      <Text variant="body" color={look.searchPlaceholder} style={{ flex: 1 }}>
        دور على مطعم أو أكلة
      </Text>
      <Text variant="footnote" color={look.searchPlaceholder} tabular>
        {`${contrastRatio(look.searchPlaceholder, theme.colors.surface).toFixed(1)}:1`}
      </Text>
    </View>
  );
}

const STAGE_LABELS: Record<keyof LiveStagePalette, string> = {
  sent: 'طلبت',
  accepted: 'المطعم وافق',
  cooking: 'دا يتحضّر',
  ready: 'جاهز',
  onTheWay: 'بالطريق',
};

function Stages({ stages }: { stages: LiveStagePalette }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="title">بطاقة الطلب بكل مرحلة</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
        {(Object.keys(STAGE_LABELS) as (keyof LiveStagePalette)[]).map((k) => {
          const s = stages[k];
          return (
            <StageCard key={k} fill={s.fill} light={s.light}>
              <Text variant="bodyStrong" color={s.on}>
                {STAGE_LABELS[k]}
              </Text>
              <Text variant="footnote" color={s.sub}>
                مطعم خالد
              </Text>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: s.accent, width: '70%' }} />
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: s.marker, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="bike" size={16} color={s.markerOn} />
              </View>
            </StageCard>
          );
        })}
      </View>
    </View>
  );
}

function StageCard({ fill, light, children }: { fill: string; light: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ width: 150, borderRadius: theme.radius.xl, overflow: 'hidden', backgroundColor: fill }}>
      <View style={{ height: 8, backgroundColor: light }} />
      <View style={{ padding: theme.space[3], gap: theme.space[2] }}>{children}</View>
    </View>
  );
}
