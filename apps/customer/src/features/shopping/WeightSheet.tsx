import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { formatAmount, formatIqd, Icon, ModalSheet, Stepper, Text, TextField, useTheme } from '@driver/ui';
import type { MessageKey } from '@driver/i18n';
import { useT } from '@/lib/i18n';
import { lineIqd } from './basket';
import type { ProduceItem } from './model';
import { useShopping } from './palette';
import { ProducePhoto } from './ProducePhoto';
import { ScaleDial } from './ScaleDial';
import { kilosLabel, piecesFor, WEIGHT_PRESETS_G, weightWords } from './weight';

export interface WeightSheetProps {
  item: ProduceItem | null;
  /** What is in the basket now (grams or pieces), 0 for none. */
  current: number;
  currentNote: string;
  stallOwner: string;
  onClose: () => void;
  onSave: (amount: number, note: string) => void;
}

/** «كيلو ونص», «2 كيلو», «ربع كيلو»: a weight in the words a stall uses. */
export function useWeightText(): (grams: number) => string {
  const t = useT();
  return (grams) => {
    const w = weightWords(grams);
    return t(w.key as MessageKey, w.kilos != null ? { n: w.kilos } : undefined);
  };
}

/**
 * How much of one item (round 2 «الميزان»): the stall's photo of it today, then the scale for things
 * sold by the kilo (drag, or tap ربع / نص / كيلو …) or a count for things sold by the piece, an
 * optional word to the stall («شوية خضرة»), and the basket button with what it comes to.
 */
export function WeightSheet({
  item,
  current,
  currentNote,
  stallOwner,
  onClose,
  onSave,
}: WeightSheetProps) {
  const theme = useTheme();
  const shop = useShopping();
  const t = useT();
  const weightText = useWeightText();
  const byKg = item?.soldBy !== 'piece';
  const [amount, setAmount] = useState(byKg ? 1000 : 1);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAmount(current > 0 ? current : item.soldBy === 'piece' ? 1 : 1000);
    setNote(currentNote);
    setNoteOpen(currentNote.length > 0);
  }, [item, current, currentNote]);

  if (!item) return null;
  const pieces = byKg ? piecesFor(item.piecesPerKg, amount) : null;
  const total = lineIqd(item, amount);
  const priceUnit = byKg
    ? t('shopping.per_kg', { amount: formatAmount(item.priceIqd) })
    : t('shopping.per_piece', { amount: formatAmount(item.priceIqd) });
  const photoWhen = item.photoToday ? t('shopping.photo_today') : t('shopping.photo_yesterday');
  const amountWords = byKg ? weightText(amount) : t('shopping.pieces', { n: amount });

  return (
    <ModalSheet
      visible
      onClose={onClose}
      title={item.name}
      subtitle={`${priceUnit} · ${photoWhen}`}
      hero={
        <ProducePhoto
          uri={item.photo}
          label={item.name}
          style={{ width: '100%', aspectRatio: 16 / 9 }}
        />
      }
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            current > 0 ? 'shopping.update_basket_a11y' : 'shopping.add_basket_a11y',
            { what: amountWords, amount: formatAmount(total) },
          )}
          onPress={() => onSave(amount, note.trim())}
          style={({ pressed }) => ({
            minHeight: 58,
            borderRadius: theme.radius.pill,
            backgroundColor: shop.fill,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingStart: theme.space[5],
            paddingEnd: theme.space[2],
            opacity: pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Text variant="button" style={{ color: shop.on }}>
            {t(current > 0 ? 'shopping.update_basket' : 'shopping.add_basket', {
              what: amountWords,
            })}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Text variant="button" tabular style={{ color: shop.on }}>
              {formatIqd(total)}
            </Text>
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 21,
                backgroundColor: theme.colors.bg,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="arrow-forward" size={18} color={theme.colors.text} />
            </View>
          </View>
        </Pressable>
      }
    >
      {byKg ? (
        <View style={{ gap: theme.space[2] }}>
          <ScaleDial
            grams={amount}
            onChange={setAmount}
            accessibilityLabel={t('shopping.scale_a11y')}
            valueText={amountWords}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: theme.space[2],
            }}
          >
            <Text variant="numeralSm" tabular>
              {kilosLabel(amount)}
            </Text>
            <Text variant="title">{t('shopping.kilo')}</Text>
          </View>
          <Text variant="footnote" color="textMuted" align="center">
            {pieces && item.piecesWord
              ? t('shopping.pieces_hint', {
                  low: pieces[0],
                  high: pieces[1],
                  word: item.piecesWord,
                })
              : t('shopping.scale_hint')}
          </Text>
          <View style={{ flexDirection: 'row', gap: theme.space[2], marginTop: theme.space[2] }}>
            {WEIGHT_PRESETS_G.map((g) => {
              const on = g === amount;
              return (
                <Pressable
                  key={g}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => {
                    theme.haptic('selection');
                    setAmount(g);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: theme.radius.pill,
                    borderWidth: on ? 2 : 1.5,
                    borderColor: on ? shop.fill : theme.colors.border,
                    backgroundColor: on ? shop.tint : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text
                    variant="label"
                    numberOfLines={1}
                    weight={on ? 700 : 600}
                    style={{ color: on ? shop.onTint : theme.colors.text }}
                  >
                    {weightText(g)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <View
          style={{ alignItems: 'center', gap: theme.space[2], paddingVertical: theme.space[4] }}
        >
          <Stepper
            value={amount}
            onChange={setAmount}
            min={1}
            max={20}
            accessibilityLabel={t('shopping.how_many')}
            style={{ alignSelf: 'center' }}
          />
          <Text variant="footnote" color="textMuted">
            {t('shopping.by_piece_hint')}
          </Text>
        </View>
      )}
      {noteOpen ? (
        <TextField
          label={t('shopping.note_label', { name: stallOwner })}
          value={note}
          onChangeText={setNote}
          placeholder={t('shopping.note_placeholder')}
          maxLength={120}
        />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => setNoteOpen(true)}
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.space[2],
            alignSelf: 'flex-start',
            marginTop: theme.space[3],
          }}
        >
          <Icon name="plus" size={18} color={shop.fill} />
          <Text variant="label" weight={600} style={{ color: shop.fill }}>
            {t('shopping.note_add', { name: stallOwner })}
          </Text>
        </Pressable>
      )}
    </ModalSheet>
  );
}
