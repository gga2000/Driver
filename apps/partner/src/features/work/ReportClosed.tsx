import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Icon, ModalSheet, Text, useNetwork, useTheme, useToast } from '@driver/ui';
import { useInPractice } from '@/features/practice/Practice';
import { useApi } from '@/lib/api';
import { apiErrorCode } from '@/lib/api-links';
import { useT } from '@/lib/i18n';
import { CLOSED_REASONS, closedReportDone, closedReportFailed, type ClosedReason } from './report-closed';

/** The courier works in one city today; the server takes the street itself from his own job's road. */
const CITY_ID = 'aziziyah';

const REASON_KEY = {
  works: 'partner.report_closed_works',
  funeral: 'partner.report_closed_funeral',
  water: 'partner.report_closed_water',
  other: 'partner.report_closed_other',
} as const satisfies Record<ClosedReason, string>;

/**
 * N20 «الشارع مسدود قدامي»: the last row of the job's «مشكلة» sheet. One tap opens «ليش مسدود؟» with four
 * reasons; one tap on a reason sends it (no typing, «غيره» included). He reads thanks while it waits for
 * ops or a second courier, and «it counts» only when the server says so — then his road is re-read, so the
 * map bends round it. Nothing in the practice job (it has no real road to report from).
 */
export function ReportClosedRow({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const t = useT();
  const toast = useToast();
  const net = useNetwork();
  const api = useApi();
  const qc = useQueryClient();
  const practice = useInPractice();
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState<ClosedReason | null>(null);
  const report = useMutation(api.closures.report.mutationOptions());

  if (practice) return null;

  const send = async (reason: ClosedReason) => {
    if (sending) return;
    if (!net.online) {
      toast.show({ message: t('partner.report_closed_offline'), tone: 'warning', icon: 'wifi-off' });
      return;
    }
    setSending(reason);
    try {
      const r = await report.mutateAsync({ cityId: CITY_ID, reason });
      theme.haptic('success');
      toast.show({ message: t(closedReportDone(r)), tone: 'success', icon: 'check' });
      if (r.confirmed) void qc.invalidateQueries({ queryKey: api.partner.jobRoute.queryKey() });
      setPicking(false);
      onDone();
    } catch (err) {
      const key = closedReportFailed(apiErrorCode(err), net.online);
      toast.show({ message: t(key), tone: 'warning', ...(key === 'partner.report_closed_offline' ? { icon: 'wifi-off' as const } : {}) });
      // Nothing to retry when there is no road ahead or today's reports are used up: back to the job.
      if (key === 'partner.report_closed_no_road' || key === 'partner.report_closed_limit') {
        setPicking(false);
        onDone();
      }
    } finally {
      setSending(null);
    }
  };

  return (
    <>
      <Pressable
        testID="problem-closed"
        accessibilityRole="button"
        onPress={() => setPicking(true)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.space[3],
          minHeight: 64,
          paddingHorizontal: theme.space[3],
          borderRadius: theme.radius.lg,
          backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
          borderWidth: 1,
          borderColor: theme.colors.border,
        })}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.warningTint }}>
          <Icon name="swap" size={20} color="warningText" strokeWidth={2.1} />
        </View>
        <Text variant="label" weight={700} style={{ flex: 1 }}>
          {t('partner.report_closed_row')}
        </Text>
        <Icon name="chevron-forward" size={18} color="textMuted" />
      </Pressable>
      <ModalSheet visible={picking} onClose={() => (sending ? undefined : setPicking(false))} locked={sending !== null} title={t('partner.report_closed_title')} testID="closed-reasons" sheetMaxWidth={560}>
        <Animated.View entering={theme.reduceMotion ? undefined : FadeIn.duration(160)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {CLOSED_REASONS.map((reason) => (
            <View key={reason} style={{ flexBasis: '45%', flexGrow: 1 }}>
              <Button
                label={t(REASON_KEY[reason])}
                variant="secondary"
                size="lg"
                fullWidth
                loading={sending === reason}
                loadingLabel={t('partner.report_closed_sending')}
                disabled={sending !== null && sending !== reason}
                onPress={() => void send(reason)}
                testID={`closed-reason-${reason}`}
              />
            </View>
          ))}
        </Animated.View>
      </ModalSheet>
    </>
  );
}
