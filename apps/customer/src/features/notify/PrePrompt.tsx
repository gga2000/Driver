import { useEffect, useState } from 'react';
import { PermissionPrompt, type IconName } from '@driver/ui';
import { useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';
import { PREPROMPT_KEY, shouldShowPrePrompt } from './prompt';
import { usePushPermission } from './usePush';

const POINTS: ReadonlyArray<{ icon: IconName; key: 'notify.preprompt.customer_point_status' | 'notify.preprompt.customer_point_door' | 'notify.preprompt.customer_point_receipts' }> = [
  { icon: 'clock', key: 'notify.preprompt.customer_point_status' },
  { icon: 'map-pin', key: 'notify.preprompt.customer_point_door' },
  { icon: 'receipt', key: 'notify.preprompt.customer_point_receipts' },
];

/**
 * Our own ask before the OS prompt (the OS one can be shown once; a "no" there is forever): what the
 * person gets, in Iraqi Arabic, with "إي، شغّلها" → OS prompt and "بعدين" → asked again in a week.
 * The sheet is the shared `PermissionPrompt` from @driver/ui.
 */
export function PrePrompt({ visible, onAllow, onLater, busy }: { visible: boolean; onAllow: () => void; onLater: () => void; busy?: boolean }) {
  const t = useT();
  return (
    <PermissionPrompt
      visible={visible}
      icon="bell"
      title={t('notify.preprompt.customer_title')}
      body={t('notify.preprompt.customer_body')}
      points={POINTS.map((p) => ({ icon: p.icon, label: t(p.key) }))}
      allowLabel={t('notify.preprompt.allow')}
      laterLabel={t('notify.preprompt.later')}
      onAllow={onAllow}
      onLater={onLater}
      busy={busy}
    />
  );
}

/**
 * Shows the pre-prompt when it is the right moment (`active`: the screen that makes notifications
 * matter is open — the first order screen) and the permission is still undetermined and not snoozed.
 */
export function PrePromptGate({ active }: { active: boolean }) {
  const { permission, ask } = usePushPermission();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!active || permission === null) return;
    let cancelled = false;
    void (async () => {
      const raw = await storage.getItem(PREPROMPT_KEY);
      const last = raw ? Number(raw) : null;
      if (!cancelled && shouldShowPrePrompt(permission, Number.isFinite(last) ? last : null, Date.now())) setVisible(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [active, permission]);

  const later = () => {
    setVisible(false);
    void storage.setItem(PREPROMPT_KEY, String(Date.now()));
  };
  const allow = async () => {
    setBusy(true);
    await ask();
    setBusy(false);
    setVisible(false);
    void storage.setItem(PREPROMPT_KEY, String(Date.now()));
  };
  return <PrePrompt visible={visible} busy={busy} onAllow={() => void allow()} onLater={later} />;
}
