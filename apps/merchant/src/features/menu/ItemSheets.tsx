import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { PriceChange } from '@driver/contracts';
import { Button, ModalSheet, Skeleton, Stepper, Text, TextField, useTheme } from '@driver/ui';
import { useLocale, useT } from '@/lib/i18n';
import { amountParam, iqd, roundToStep } from '@/lib/money';
import { clock12 } from '@/lib/time';
import { dayMonth } from '@/features/deals/logic';
import { Glyph } from './Glyph';
import { draftKey, groupProblems, offStep, parseDelta, parsePrice, parseServes, priceChange, setMinMax, setRequired, type DraftGroup } from './logic';
import { GlyphButton, Pill, Toggle } from './parts';

/** New price: typed by staff, with what the customer will see and the last change for context. */
export function PriceSheet({ visible, name, current, busy, onClose, onSave }: { visible: boolean; name: string; current: number; busy: boolean; onClose: () => void; onSave: (priceIqd: number) => void }) {
  const theme = useTheme();
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(String(current));
  useEffect(() => {
    if (visible) setText(String(current));
  }, [visible, current]);
  const price = parsePrice(text);
  const change = price !== null ? priceChange(current, price) : null;
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      testID="price-sheet"
      title={t('merchant.item.price_title', { name })}
      subtitle={t('merchant.item.price_now', { amount: amountParam(current) })}
      footer={<Button testID="price-save" label={price !== null ? t('merchant.item.price_save', { amount: amountParam(price) }) : t('merchant.item.price_save_plain')} fullWidth size="lg" disabled={price === null || price === current} loading={busy} onPress={() => price !== null && onSave(price)} />}
    >
      <TextField
        testID="price-input"
        label={t('merchant.item.price_label')}
        value={text}
        onChangeText={setText}
        keyboardType="number-pad"
        autoFocus
        selectTextOnFocus
        trailing={
          <Text variant="label" color="textMuted" style={{ paddingHorizontal: theme.space[3] }}>
            {t('merchant.item.currency')}
          </Text>
        }
        error={text.trim() && price === null ? t('merchant.item.price_invalid') : undefined}
      />
      {change && change.direction !== 'same' && change.direction !== 'first' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Glyph name={change.direction === 'up' ? 'trend-up' : 'trend-down'} size={20} color={change.direction === 'up' ? 'warningText' : 'successText'} />
          <Text variant="label" color={change.direction === 'up' ? 'warningText' : 'successText'} tabular>
            {change.direction === 'up' ? t('merchant.item.price_up', { amount: amountParam(change.delta) }) : t('merchant.item.price_down', { amount: amountParam(-change.delta) })}
          </Text>
        </View>
      ) : null}
      {price !== null && offStep(price) ? (
        <View style={{ flexDirection: 'row', gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.colors.warningTint }}>
          <Glyph name="info" size={18} color="warningText" />
          <Text variant="footnote" color="text" style={{ flex: 1 }}>
            {t('merchant.item.price_step', { amount: iqd(roundToStep(price), { locale }) })}
          </Text>
        </View>
      ) : null}
      <Text variant="footnote" color="textMuted">
        {t('merchant.item.price_note')}
      </Text>
    </ModalSheet>
  );
}

/** Every price this dish has had, newest first (who changed it and when). */
export function HistorySheet({ visible, name, history, loading, onClose }: { visible: boolean; name: string; history: PriceChange[] | undefined; loading: boolean; onClose: () => void }) {
  const theme = useTheme();
  const t = useT();
  return (
    <ModalSheet visible={visible} onClose={onClose} testID="history-sheet" title={t('merchant.item.history_title')} subtitle={name}>
      {loading || !history ? (
        <View style={{ gap: theme.space[2] }}>
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      ) : history.length === 0 ? (
        <Text variant="body" color="textMuted">
          {t('merchant.item.history_empty')}
        </Text>
      ) : (
        <View>
          {history.map((h, i) => {
            const c = priceChange(h.oldPriceIqd, h.newPriceIqd);
            const tone = c.direction === 'up' ? 'warning' : c.direction === 'down' ? 'success' : 'neutral';
            return (
              <View key={`${h.at.getTime()}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}>
                <View style={{ alignItems: 'center', width: 12 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i === 0 ? theme.colors.accent : theme.colors.borderStrong }} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" tabular>
                    {c.direction === 'first' ? t('merchant.item.history_first', { amount: amountParam(h.newPriceIqd) }) : t('merchant.item.history_change', { from: amountParam(h.oldPriceIqd), to: amountParam(h.newPriceIqd) })}
                  </Text>
                  <Text variant="caption" color="textMuted" tabular>
                    {t('merchant.item.history_when', { date: dayMonth(h.at), time: clock12(h.at) })}
                  </Text>
                </View>
                {c.direction === 'up' || c.direction === 'down' ? <Pill size="sm" tone={tone} label={amountParam(c.delta, { sign: true })} /> : null}
              </View>
            );
          })}
        </View>
      )}
    </ModalSheet>
  );
}

/** One options group: name, required or not, how many picks, and each option with its extra price. */
export function GroupSheet({ visible, group, isNew, busy, onClose, onSave, onDelete }: { visible: boolean; group: DraftGroup | null; isNew: boolean; busy: boolean; onClose: () => void; onSave: (g: DraftGroup) => void; onDelete: () => void }) {
  const theme = useTheme();
  const t = useT();
  const [g, setG] = useState<DraftGroup | null>(group);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (visible) {
      setG(group);
      setTried(false);
    }
  }, [visible, group]);
  if (!g) return null;
  const problems = groupProblems(g);
  const patchOption = (key: string, patch: Partial<DraftGroup['modifiers'][number]>) => setG({ ...g, modifiers: g.modifiers.map((m) => (m.key === key ? { ...m, ...patch } : m)) });
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      size="lg"
      testID="group-sheet"
      title={isNew ? t('merchant.item.group_new') : t('merchant.item.group_edit', { name: group?.nameAr ?? '' })}
      footer={
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {!isNew ? <Button label={t('merchant.item.group_delete')} variant="secondary" onPress={onDelete} style={{ flex: 1 }} /> : null}
          <Button
            testID="group-save"
            label={t('merchant.item.group_save')}
            size="lg"
            loading={busy}
            style={{ flex: 2 }}
            fullWidth
            onPress={() => {
              setTried(true);
              if (problems.length === 0) onSave(g);
            }}
          />
        </View>
      }
    >
      <TextField testID="group-name" label={t('merchant.item.group_name')} placeholder={t('merchant.item.group_name_placeholder')} value={g.nameAr} onChangeText={(v) => setG({ ...g, nameAr: v })} error={tried && problems.includes('name') ? t('merchant.item.group_name_missing') : undefined} maxLength={60} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.surfaceSunken }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{t('merchant.item.group_required')}</Text>
          <Text variant="footnote" color="textMuted">
            {g.required ? t('merchant.item.group_required_on') : t('merchant.item.group_required_off')}
          </Text>
        </View>
        <Toggle testID="group-required" label={t('merchant.item.group_required')} value={g.required} onChange={(v) => setG(setRequired(g, v))} />
      </View>
      <View style={{ flexDirection: 'row', gap: theme.space[4], flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 200, gap: theme.space[1] }}>
          <Text variant="label">{t('merchant.item.group_min')}</Text>
          <Stepper value={g.minSelect} min={0} max={g.maxSelect} onChange={(n) => setG(setMinMax(g, n, g.maxSelect))} accessibilityLabel={t('merchant.item.group_min')} />
        </View>
        <View style={{ flex: 1, minWidth: 200, gap: theme.space[1] }}>
          <Text variant="label">{t('merchant.item.group_max')}</Text>
          <Stepper value={g.maxSelect} min={Math.max(1, g.minSelect)} max={Math.max(1, Math.min(20, g.modifiers.length))} onChange={(n) => setG(setMinMax(g, g.minSelect, n))} accessibilityLabel={t('merchant.item.group_max')} />
        </View>
      </View>
      <Text variant="footnote" color="textMuted">
        {t('merchant.item.group_customer_sees')} <Text variant="footnote" weight={600}>{ruleText(t, g)}</Text>
      </Text>

      <View style={{ gap: theme.space[2] }}>
        <Text variant="label">{t('merchant.item.options')}</Text>
        {g.modifiers.map((m, i) => {
          const badPrice = parseDelta(m.price) === null;
          return (
            <View key={m.key} style={{ gap: theme.space[1] }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
                <TextField
                  testID={`option-name-${i}`}
                  placeholder={t('merchant.item.option_name')}
                  value={m.nameAr}
                  onChangeText={(v) => patchOption(m.key, { nameAr: v })}
                  style={{ flex: 2 }}
                  maxLength={60}
                  error={tried && !m.nameAr.trim() ? t('merchant.item.option_name_missing') : undefined}
                />
                <TextField
                  testID={`option-price-${i}`}
                  placeholder="0"
                  value={m.price}
                  onChangeText={(v) => patchOption(m.key, { price: v })}
                  keyboardType="number-pad"
                  style={{ flex: 1, minWidth: 110 }}
                  trailing={
                    <Text variant="caption" color="textMuted" style={{ paddingHorizontal: theme.space[2] }}>
                      +
                    </Text>
                  }
                  error={badPrice ? t('merchant.item.price_invalid') : undefined}
                />
                <View style={{ height: 52, justifyContent: 'center' }}>
                  <Toggle label={t('merchant.item.option_available', { name: m.nameAr })} value={m.available} onChange={(v) => patchOption(m.key, { available: v })} />
                </View>
                <View style={{ height: 52, justifyContent: 'center' }}>
                  <GlyphButton glyph="trash" size={40} variant="plain" color="textMuted" label={t('merchant.item.option_remove', { name: m.nameAr })} onPress={() => setG({ ...g, modifiers: g.modifiers.filter((x) => x.key !== m.key) })} />
                </View>
              </View>
              {/* Joy o3: how many this option feeds, shown to customers as «يشبّع 2–3». */}
              <TextField
                testID={`option-serves-${i}`}
                placeholder={t('merchant.item.option_serves')}
                accessibilityLabel={t('merchant.item.option_serves')}
                value={m.serves ?? ''}
                onChangeText={(v) => patchOption(m.key, { serves: v })}
                maxLength={7}
                error={parseServes(m.serves) === 'invalid' ? t('merchant.item.option_serves_invalid') : undefined}
              />
            </View>
          );
        })}
        <Pressable
          testID="option-add"
          accessibilityRole="button"
          onPress={() => setG({ ...g, modifiers: [...g.modifiers, { key: draftKey('m'), nameAr: '', price: '0', available: true }] })}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space[2], height: 48, paddingHorizontal: theme.space[3], borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.borderStrong, opacity: pressed ? 0.7 : 1 })}
        >
          <Glyph name="plus" size={20} color="accentText" strokeWidth={2} />
          <Text variant="bodyStrong" color="accentText">
            {t('merchant.item.option_add')}
          </Text>
        </Pressable>
        {tried && problems.some((p) => p === 'no_options' || p === 'max_over_options' || p === 'min_over_max') ? (
          <Text variant="footnote" color="dangerText">
            {problems.includes('no_options') ? t('merchant.item.group_no_options') : t('merchant.item.group_max_over')}
          </Text>
        ) : null}
      </View>
    </ModalSheet>
  );
}

/** The customer's wording of the rule ("لازم تختار · اختار واحد"), same keys as the customer app. */
export function ruleText(t: ReturnType<typeof useT>, g: { required: boolean; minSelect: number; maxSelect: number }): string {
  const need = g.required ? t('item.modifier_required') : t('item.modifier_optional');
  const how = g.maxSelect === 1 ? t('item.choose_one') : g.minSelect > 1 ? t('item.choose_at_least', { n: g.minSelect }) : t('item.choose_up_to', { n: g.maxSelect });
  return `${need} · ${how}`;
}
