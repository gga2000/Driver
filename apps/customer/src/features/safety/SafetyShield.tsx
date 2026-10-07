import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { SAFETY_RULES, type SosSubject } from '@driver/contracts';
import { Icon, ModalSheet, SosButton, Text, useTheme } from '@driver/ui';
import { ActionRow } from '@/features/track/SheetParts';
import { useT } from '@/lib/i18n';
import { SosModal } from './SosControl';
import { useSos } from './useSos';

/**
 * Ride idea t3: one safety button, in the same corner of every ride screen. A shield «أمان» opens a
 * small sheet holding the three things: SOS (the same 3-second hold, police 911 inside it), share the
 * ride with family, report a problem. While an alert is open the shield turns red and opens the SOS
 * sheet directly — no menu between the rider and help.
 */
export function SafetyShield({ subject, car, onShare, onReport, onShareLocation }: { subject: SosSubject; car: string | null; onShare: () => void; onReport: () => void; onShareLocation: () => void }) {
  const theme = useTheme();
  const t = useT();
  const sos = useSos(subject);
  const [open, setOpen] = useState(false);
  const after = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <>
      <Pressable
        testID="safety-shield"
        accessibilityRole="button"
        accessibilityLabel={sos.active ? t('ride.shield_active') : t('ride.shield_a11y')}
        onPress={() => {
          theme.haptic('selection');
          if (sos.active) sos.open();
          else setOpen(true);
        }}
        hitSlop={4}
        style={({ pressed }) => ({
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: theme.space[3],
          borderRadius: 22,
          borderWidth: 1,
          borderColor: sos.active ? theme.colors.danger : theme.colors.border,
          backgroundColor: sos.active ? theme.colors.danger : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        })}
      >
        <Icon name={sos.active ? 'sos' : 'shield'} size={20} color={sos.active ? 'onDanger' : 'successText'} strokeWidth={2.2} />
        <Text variant="label" weight={700} color={sos.active ? 'onDanger' : 'text'}>
          {sos.active ? t('ride.shield_active') : t('ride.shield')}
        </Text>
      </Pressable>
      <ModalSheet visible={open} onClose={() => setOpen(false)} title={t('ride.shield_title')} subtitle={car ? t('ride.shield_car', { car }) : undefined} testID="safety-sheet">
        <View style={{ gap: theme.space[2], paddingBottom: theme.space[4] }}>
          <View testID="safety-sos" style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], padding: theme.space[3], borderRadius: theme.radius.lg, backgroundColor: theme.colors.dangerTint }}>
            <SosButton onTrigger={after(sos.trigger)} onRelease={sos.release} />
            <Text variant="footnote" color="dangerText" style={{ flex: 1 }}>
              {t('ride.shield_sos', { number: SAFETY_RULES.policeNumber })}
            </Text>
          </View>
          <ActionRow icon="share" label={t('ride.shield_share')} hint={t('ride.shield_share_hint')} onPress={after(onShare)} testID="safety-share" />
          <ActionRow icon="flag" label={t('order.report_problem')} onPress={after(onReport)} testID="safety-report" />
        </View>
      </ModalSheet>
      <SosModal sos={sos} car={car} onShareLocation={onShareLocation} />
    </>
  );
}
