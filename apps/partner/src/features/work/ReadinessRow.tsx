import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Button, Icon, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { pluralKey } from '@driver/i18n';
import { Glyph } from '@/features/account/Glyph';
import { ModalSheet } from '@/features/account/ModalSheet';
import { playTestSound } from '@/lib/alert';
import { useT, type TFn } from '@/lib/i18n';
import { askGps, openSettings } from '@/lib/readiness-probe';
import type { ReadyItem, ReadyKey, ReadyTone } from './readiness';
import { useReadiness } from './useReadiness';

const TONE: Record<ReadyTone, { fg: ThemeColorKey; bg: ThemeColorKey }> = {
  ok: { fg: 'successText', bg: 'successTint' },
  warn: { fg: 'warningText', bg: 'warningTint' },
  bad: { fg: 'dangerText', bg: 'dangerTint' },
};

/** "64%" in one left-to-right piece, so Arabic never shows it as "%64". */
const pct = (n: number) => `\u2066${n}%\u2069`;

function iconOf(item: ReadyItem): IconName {
  if (item.key === 'gps') return 'location-arrow';
  if (item.key === 'net') return item.tone === 'ok' ? 'wifi' : 'wifi-off';
  if (item.key === 'sound') return 'volume';
  return 'battery';
}

function labelOf(item: ReadyItem, t: TFn): string {
  if (item.key === 'battery') return t('partner.ready_battery', { percent: pct(item.percent ?? 0) });
  return t(`partner.ready_${item.key}` as `partner.ready_${Exclude<ReadyKey, 'battery'>}`);
}

/**
 * "جاهز تستلم طلبات" above the online switch (UI/UX audit S-8, every shift): GPS · النت · صوت الطلبات ·
 * البطارية 64%, each with its own icon in its state colour (never a ✓ glyph — IBM Plex Sans Arabic has
 * none). The whole row is one 44-px+ target: it opens a sheet where every item that needs a look says
 * why in a sentence and carries its fix (allow location, open settings, play the sound).
 */
export function ReadinessRow({ enabled = true }: { enabled?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const r = useReadiness(enabled);
  const [open, setOpen] = useState(false);
  const ok = r.issues === 0;
  const title = ok ? t('partner.ready_title') : t(pluralKey('partner.ready_issues', r.issues), { n: r.issues });
  const spoken = r.items.map((i) => t(i.tone === 'ok' ? 'partner.ready_ok_a11y' : 'partner.ready_bad_a11y', { item: labelOf(i, t) })).join('، ');
  return (
    <>
      <Pressable
        testID="readiness"
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${spoken}`}
        onPress={() => {
          theme.haptic('selection');
          r.recheck();
          setOpen(true);
        }}
        style={({ pressed }) => ({
          minHeight: 48,
          gap: 4,
          paddingVertical: theme.space[2],
          paddingHorizontal: theme.space[3],
          borderRadius: theme.radius.lg,
          backgroundColor: pressed ? theme.colors.surfaceSunken : ok ? theme.colors.surface : theme.colors.warningTint,
          borderWidth: 1,
          borderColor: ok ? theme.colors.border : theme.colors.warning,
        })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          {ok ? (
            <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: theme.colors.success, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={12} color="surface" strokeWidth={3} />
            </View>
          ) : (
            <Glyph name="alert" size={18} color="warningText" />
          )}
          <Text testID="readiness-title" variant="label" weight={600} color={ok ? 'successText' : 'warningText'} style={{ flex: 1 }}>
            {title}
          </Text>
          <Icon name="chevron-forward" size={16} color="textMuted" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space[3], rowGap: 2 }}>
          {r.items.map((i) => (
            <View key={i.key} testID={`ready-${i.key}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name={iconOf(i)} size={14} color={TONE[i.tone].fg} strokeWidth={2.2} />
              <Text variant="caption" weight={i.tone === 'ok' ? 400 : 600} color={i.tone === 'ok' ? 'textMuted' : TONE[i.tone].fg} tabular>
                {labelOf(i, t)}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
      <ReadinessSheet visible={open} onClose={() => setOpen(false)} title={title} items={r.items} onFixed={r.recheck} setGps={r.setGps} setSound={r.setSound} />
    </>
  );
}

function ReadinessSheet({
  visible,
  onClose,
  title,
  items,
  onFixed,
  setGps,
  setSound,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  items: ReadyItem[];
  onFixed: () => void;
  setGps: ReturnType<typeof useReadiness>['setGps'];
  setSound: ReturnType<typeof useReadiness>['setSound'];
}) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState<ReadyKey | null>(null);
  const sorted = [...items].sort((a, b) => rank(b.tone) - rank(a.tone));
  const fix = async (item: ReadyItem) => {
    setBusy(item.key);
    try {
      if (item.fix === 'gps') setGps(await askGps());
      else if (item.fix === 'settings') await openSettings();
      else if (item.fix === 'sound') {
        const played = await playTestSound();
        if (!played) toast.show({ message: t('partner.test_sound_blocked'), tone: 'warning' });
        else setSound('ready');
      }
      onFixed();
    } finally {
      setBusy(null);
    }
  };
  return (
    <ModalSheet visible={visible} onClose={onClose} title={title} testID="readiness-sheet">
      <View style={{ gap: theme.space[3] }}>
        {sorted.map((i) => (
          <View key={i.key} testID={`ready-row-${i.key}`} style={{ flexDirection: 'row', alignItems: i.problem ? 'flex-start' : 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: i.tone === 'ok' ? theme.colors.surfaceSunken : theme.colors[TONE[i.tone].bg] }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={iconOf(i)} size={18} color={TONE[i.tone].fg} />
            </View>
            <View style={{ flex: 1, gap: theme.space[2] }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="label" weight={600} style={{ flex: 1 }}>
                  {labelOf(i, t)}
                </Text>
                {i.tone === 'ok' ? <Icon name="check" size={18} color="successText" strokeWidth={2.6} /> : null}
              </View>
              {i.problem ? (
                <Text variant="footnote" color={TONE[i.tone].fg}>
                  {t(i.problem, { percent: pct(i.percent ?? 0) })}
                </Text>
              ) : null}
              {i.fix && i.tone !== 'ok' ? (
                <Button
                  testID={`ready-fix-${i.key}`}
                  size="sm"
                  variant={i.tone === 'bad' ? 'primary' : 'secondary'}
                  label={t(i.fix === 'gps' ? 'partner.ready_fix_gps' : i.fix === 'settings' ? 'partner.ready_fix_settings' : i.fix === 'sound' ? 'partner.ready_fix_sound' : 'partner.ready_fix_retry')}
                  icon={i.fix === 'sound' ? 'volume' : i.fix === 'gps' ? 'location-arrow' : i.fix === 'retry' ? 'refresh' : undefined}
                  loading={busy === i.key}
                  onPress={() => void fix(i)}
                  style={{ alignSelf: 'flex-start', minHeight: 44 }}
                />
              ) : null}
            </View>
          </View>
        ))}
        <Button testID="readiness-close" label={t('partner.ready_fix_ok')} variant="secondary" fullWidth onPress={onClose} />
      </View>
    </ModalSheet>
  );
}

function rank(tone: ReadyTone): number {
  return tone === 'bad' ? 2 : tone === 'warn' ? 1 : 0;
}
