import { Modal, type StyleProp, type ViewStyle } from 'react-native';
import { SAFETY_RULES, type SosSubject } from '@driver/contracts';
import { SosButton, SosSheet } from '@driver/ui';
import { useSos } from './useSos';

/**
 * "طوارئ" on an active trip (scoring & safety §3; audit P-02): the shared 3-second-hold button and,
 * once the alert is sent, the confirmation sheet over the whole screen in the rider order (L-17):
 * the police call first, the car to read out, «فريق درايفر» watching, and — with no emergency
 * contact — "send my location to someone I trust". Renders nothing without a trip to name.
 */
export function SosControl({
  subject,
  variant = 'pill',
  car = null,
  onShareLocation,
  style,
}: {
  subject: SosSubject | null;
  variant?: 'pill' | 'round';
  /** "عباس · تويوتا كورولا أبيض · واسط 31207" (rides), to read out to the police. */
  car?: string | null;
  /** No emergency contact: open the system share sheet with a live link. */
  onShareLocation?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const sos = useSos(subject);
  if (!subject) return null;
  const v = sos.view;
  return (
    <>
      <SosButton variant={variant} active={sos.active} onPressActive={sos.open} onTrigger={sos.trigger} onRelease={sos.release} style={style} />
      <Modal visible={sos.phase !== null} transparent animationType="fade" onRequestClose={sos.close} statusBarTranslucent>
        {sos.phase ? (
          <SosSheet
            layout="rider"
            car={car}
            {...(onShareLocation ? { onShareLocation } : {})}
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
        ) : null}
      </Modal>
    </>
  );
}
