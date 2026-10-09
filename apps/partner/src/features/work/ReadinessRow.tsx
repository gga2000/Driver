import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { ThemeColorKey } from '@driver/design-tokens';
import { Button, Icon, ModalSheet, Text, useTheme, useToast, type IconName } from '@driver/ui';
import { pluralKey, type MessageKey } from '@driver/i18n';
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

/** The short line for the one thing that needs a look (check-up item 3): the sheet keeps the full sentence. */
const SHORT: Record<string, MessageKey> = {
  'partner.ready_gps_ask': 'partner.ready_line_gps_ask',
  'partner.ready_gps_off': 'partner.ready_line_gps_off',
  'partner.ready_net_off': 'partner.ready_line_net_off',
  'partner.ready_sound_off': 'partner.ready_line_sound_off',
  'partner.ready_push_off': 'partner.ready_line_push_off',
  'partner.ready_battery_low': 'partner.ready_line_battery_low',
  'partner.ready_battery_saver': 'partner.ready_line_battery_saver',
};

const FIX_LABEL = { gps: 'partner.ready_fix_gps', settings: 'partner.ready_fix_settings', sound: 'partner.ready_fix_sound', retry: 'partner.ready_fix_retry' } as const;

/**
 * "جاهز تستلم طلبات" above the start slide (UI/UX audit S-8, every shift; check-up item 3, Ali 2026-10-09):
 * when all is well, nothing at all. When something isn't, ONE line that names it — «الموقع مطفي» — in the
 * worst item's colour, with its fix button right there (allow location, open settings, play the sound) and
 * «+1» when more than one thing needs a look. Tapping the line opens the sheet with every item and why.
 */
export function ReadinessRow({ enabled = true }: { enabled?: boolean }) {
  const theme = useTheme();
  const t = useT();
  const r = useReadiness(enabled);
  const [open, setOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const toast = useToast();
  if (r.issues === 0) return null;
  const title = t(pluralKey('partner.ready_issues', r.issues), { n: r.issues });
  const worst = [...r.items].sort((a, b) => rank(b.tone) - rank(a.tone))[0]!;
  const tone = TONE[worst.tone];
  const line = worst.problem ? t(SHORT[worst.problem] ?? worst.problem, { percent: pct(worst.percent ?? 0) }) : labelOf(worst, t);
  const more = r.issues - 1;
  const fix = async () => {
    setFixing(true);
    try {
      await runFix(worst, r, () => toast.show({ message: t('partner.test_sound_blocked'), tone: 'warning' }));
    } finally {
      setFixing(false);
    }
  };
  return (
    <>
      <Pressable
        testID="readiness"
        accessibilityRole="button"
        accessibilityLabel={`${line}. ${title}`}
        onPress={() => {
          theme.haptic('selection');
          r.recheck();
          setOpen(true);
        }}
        style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], paddingHorizontal: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors[tone.bg], opacity: pressed ? 0.85 : 1 })}
      >
        <Icon name={iconOf(worst)} size={20} color={tone.fg} strokeWidth={2.2} />
        <Text testID="readiness-title" variant="label" weight={700} color={tone.fg} style={{ flex: 1 }}>
          {line}
        </Text>
        {more > 0 ? (
          <Text testID="readiness-more" variant="caption" weight={700} color={tone.fg} tabular>
            {t('partner.ready_more', { n: more })}
          </Text>
        ) : null}
        {worst.fix ? (
          <Button testID={`ready-line-fix-${worst.key}`} size="sm" variant={worst.tone === 'bad' ? 'primary' : 'secondary'} label={t(FIX_LABEL[worst.fix])} loading={fixing} onPress={() => void fix()} style={{ minHeight: 44 }} />
        ) : null}
      </Pressable>
      <ReadinessSheet visible={open} onClose={() => setOpen(false)} title={title} items={r.items} onFixed={r.recheck} setGps={r.setGps} setSound={r.setSound} />
    </>
  );
}

/** Runs one item's fix (shared by the line's button and the sheet). */
async function runFix(item: ReadyItem, r: Pick<ReturnType<typeof useReadiness>, 'setGps' | 'setSound' | 'recheck'>, soundBlocked: () => void) {
  if (item.fix === 'gps') r.setGps(await askGps());
  else if (item.fix === 'settings') await openSettings();
  else if (item.fix === 'sound') {
    if (await playTestSound()) r.setSound('ready');
    else soundBlocked();
  }
  r.recheck();
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
      await runFix(item, { setGps, setSound, recheck: onFixed }, () => toast.show({ message: t('partner.test_sound_blocked'), tone: 'warning' }));
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
                  label={t(FIX_LABEL[i.fix])}
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
