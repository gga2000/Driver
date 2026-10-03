import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button, Text, TextField, useTheme } from '@driver/ui';
import { ModalSheet } from '@/components/ModalSheet';
import { useT } from '@/lib/i18n';
import { moveInOrder } from './logic';
import { GlyphButton } from './parts';

/** New section, or rename one (every dish in it moves with the name). */
export function CategoryNameSheet({
  visible,
  renameFrom,
  existing,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  renameFrom: string | null;
  existing: readonly string[];
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const theme = useTheme();
  const t = useT();
  const [name, setName] = useState(renameFrom ?? '');
  useEffect(() => {
    if (visible) setName(renameFrom ?? '');
  }, [visible, renameFrom]);
  const trimmed = name.trim();
  const taken = trimmed !== '' && trimmed !== renameFrom && existing.includes(trimmed);
  const ok = trimmed.length >= 2 && trimmed.length <= 40 && !taken && trimmed !== renameFrom;
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      testID="category-sheet"
      title={renameFrom ? t('merchant.menu.rename_title', { name: renameFrom }) : t('merchant.menu.new_section_title')}
      footer={<Button testID="category-save" label={renameFrom ? t('merchant.menu.rename_save') : t('merchant.menu.new_section_save')} fullWidth size="lg" disabled={!ok} loading={busy} onPress={() => onSave(trimmed)} />}
    >
      <TextField testID="category-name" label={t('merchant.menu.section_name')} placeholder={t('merchant.menu.section_placeholder')} value={name} onChangeText={setName} autoFocus maxLength={40} error={taken ? t('merchant.menu.section_taken') : undefined} />
      <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
        <Text variant="footnote" color="textMuted">
          {renameFrom ? t('merchant.menu.rename_hint') : t('merchant.menu.new_section_hint')}
        </Text>
      </View>
    </ModalSheet>
  );
}

/** Section order as customers scroll it: move each up or down, then save once. */
export function ReorderSheet({ visible, sections, busy, onClose, onSave }: { visible: boolean; sections: readonly string[]; busy: boolean; onClose: () => void; onSave: (order: string[]) => void }) {
  const theme = useTheme();
  const t = useT();
  const [order, setOrder] = useState<string[]>([...sections]);
  useEffect(() => {
    if (visible) setOrder([...sections]);
  }, [visible, sections]);
  const changed = order.join('|') !== sections.join('|');
  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      testID="reorder-sheet"
      title={t('merchant.menu.reorder_title')}
      subtitle={t('merchant.menu.reorder_hint')}
      footer={<Button testID="reorder-save" label={t('merchant.menu.reorder_save')} fullWidth size="lg" disabled={!changed} loading={busy} onPress={() => onSave(order)} />}
    >
      <View style={{ borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden' }}>
        {order.map((name, i) => (
          <View
            key={name}
            testID={`reorder-row-${i}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], paddingVertical: theme.space[2], paddingHorizontal: theme.space[3], backgroundColor: theme.colors.surface, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.colors.border }}
          >
            <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: theme.colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
              <Text variant="label" weight={700} tabular>
                {i + 1}
              </Text>
            </View>
            <Text variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
              {name}
            </Text>
            <GlyphButton testID={`reorder-up-${i}`} glyph="arrow-up" size={40} variant="tonal" label={t('merchant.menu.move_up', { name })} disabled={i === 0} onPress={() => setOrder((o) => moveInOrder(o, i, -1))} />
            <GlyphButton testID={`reorder-down-${i}`} glyph="arrow-down" size={40} variant="tonal" label={t('merchant.menu.move_down', { name })} disabled={i === order.length - 1} onPress={() => setOrder((o) => moveInOrder(o, i, 1))} />
          </View>
        ))}
      </View>
    </ModalSheet>
  );
}
