import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, Share, View, type StyleProp, type ViewStyle } from 'react-native';
import { SAFETY_RULES, type SosSubject } from '@driver/contracts';
import { partnerThemes } from '@driver/design-tokens';
import { Icon, ModalSheet, SosButton, SosSheet, Text, ThemeProvider, useTheme, useToast, type IconName } from '@driver/ui';
import { useMe } from '@/features/work/queries';
import { useT } from '@/lib/i18n';
import { currentFix } from '@/lib/location';
import { useSos } from './useSos';

/**
 * Safety on an active trip (partner redesign r1, f7; scoring & safety §3). A calm shield in the header
 * instead of a red «طوارئ» pill: a tap opens one place with the 3-second hold that alerts the Driver
 * team, sharing his location with someone he trusts, the emergency number on its own, and his
 * emergency contact. Once an alert is sent the confirmation sheet (with the 10-second cancel) is drawn
 * dark and calm; while it is open the shield turns solid and a tap reopens it. Renders nothing without
 * a trip to name.
 */
export function SosControl({ subject, openSignal = 0, style }: { subject: SosSubject | null; variant?: 'pill' | 'round'; /** Bump to open it from elsewhere (the job's «مشكلة» sheet). */ openSignal?: number; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  const t = useT();
  const sos = useSos(subject);
  const [open, setOpen] = useState(false);
  const reopen = sos.open;
  const active = sos.active;
  useEffect(() => {
    if (!openSignal) return;
    if (active) reopen();
    else setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  if (!subject) return null;
  const v = sos.view;
  return (
    <>
      <Pressable
        testID="safety-button"
        accessibilityRole="button"
        accessibilityLabel={sos.active ? t('partner.safety_active') : t('partner.safety_a11y')}
        onPress={() => {
          theme.haptic('selection');
          if (sos.active) sos.open();
          else setOpen(true);
        }}
        hitSlop={6}
        style={({ pressed }) => [
          {
            width: 48,
            height: 48,
            borderRadius: 24,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: sos.active ? theme.colors.danger : pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            borderWidth: sos.active ? 0 : 1,
            borderColor: theme.colors.border,
          },
          style,
        ]}
      >
        <Icon name={sos.active ? 'sos' : 'shield'} size={22} color={sos.active ? 'onDanger' : 'text'} strokeWidth={2.1} />
      </Pressable>
      <SafetySheet
        visible={open && sos.phase === null}
        onClose={() => setOpen(false)}
        onTrigger={() => {
          setOpen(false);
          sos.trigger();
        }}
        onRelease={sos.release}
        onCallPolice={sos.callPolice}
      />
      <Modal visible={sos.phase !== null} transparent animationType="fade" onRequestClose={sos.close} statusBarTranslucent>
        {sos.phase ? (
          // f7: after the alert, the sheet in the ember night palette — dark and calm, nothing that glares.
          <ThemeProvider theme="light" colors={partnerThemes.ember} fonts={theme.fonts} haptics={theme.haptic} direction={theme.direction} reduceMotion={theme.reduceMotion}>
            <SosSheet
              phase={sos.phase}
              cancelUntil={sos.cancelUntil}
              acknowledgedBy={v?.acknowledgedBy ?? null}
              contactName={v ? v.contactName : undefined}
              contactNotified={v ? v.contactStatus === 'sent' || v.contactStatus === 'delivered' || v.contactStatus === 'sms' : false}
              sharing={v?.sharing ?? true}
              cancelling={sos.cancelling}
              policeNumber={SAFETY_RULES.policeNumber}
              onCancel={sos.cancel}
              onClose={sos.close}
              onRetry={sos.retry}
              onCallPolice={sos.callPolice}
            />
          </ThemeProvider>
        ) : null}
      </Modal>
    </>
  );
}

/** r1: the one calm place — hold to alert, share the location, the emergency number, the contact. */
function SafetySheet({ visible, onClose, onTrigger, onRelease, onCallPolice }: { visible: boolean; onClose: () => void; onTrigger: () => void; onRelease: () => void; onCallPolice: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const me = useMe();
  const contact = me.data?.emergencyContact ?? null;
  const [sharing, setSharing] = useState(false);

  const share = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const fix = await currentFix(5000);
      if (!fix) {
        toast.show({ message: t('partner.safety_no_fix'), tone: 'warning', icon: 'location-arrow' });
        return;
      }
      const url = `https://maps.google.com/?q=${fix.lat.toFixed(6)},${fix.lng.toFixed(6)}`;
      await Share.share({ message: t('partner.safety_share_text', { url }) }).catch(() => undefined);
    } finally {
      setSharing(false);
    }
  };

  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('partner.safety_title')} subtitle={t('partner.safety_body')} testID="safety-sheet" sheetMaxWidth={560}>
      <View style={{ gap: theme.space[3] }}>
        <View style={{ alignItems: 'center', paddingTop: theme.space[6], paddingBottom: theme.space[4], borderRadius: theme.radius.xl, backgroundColor: theme.colors.surfaceSunken }}>
          <SosButton variant="round" onTrigger={onTrigger} onRelease={onRelease} style={{ transform: [{ scale: 1.5 }], marginVertical: theme.space[3] }} />
        </View>
        <SafetyRow icon="share" title={t('partner.safety_share')} body={t('partner.safety_share_sub')} onPress={() => void share()} busy={sharing} testID="safety-share" />
        <SafetyRow icon="phone" title={t('sos.call_police', { number: SAFETY_RULES.policeNumber })} body={null} onPress={onCallPolice} testID="safety-police" />
        <SafetyRow
          icon="user"
          title={contact ? t('partner.safety_contact', { name: contact.name }) : t('partner.safety_contact_none')}
          body={t('partner.safety_contact_sub')}
          onPress={() => {
            onClose();
            router.push('/emergency');
          }}
          testID="safety-contact"
        />
      </View>
    </ModalSheet>
  );
}

function SafetyRow({ icon, title, body, onPress, busy = false, testID }: { icon: IconName; title: string; body: string | null; onPress: () => void; busy?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 60,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
        opacity: busy ? 0.6 : 1,
      })}
    >
      <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surfaceSunken }}>
        <Icon name={icon} size={20} color="text" strokeWidth={2.1} />
      </View>
      <View style={{ flex: 1 }}>
        <Text variant="label" weight={700} tabular>
          {title}
        </Text>
        {body ? (
          <Text variant="caption" color="textMuted">
            {body}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron-forward" size={18} color="textMuted" />
    </Pressable>
  );
}
