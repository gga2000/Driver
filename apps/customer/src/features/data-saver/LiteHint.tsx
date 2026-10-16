import { useEffect, useRef } from 'react';
import { useDataSaver, useToast } from '@driver/ui';
import { dataSaverLoaded, liteHintFor, LITE_HINT_KEY, saveDataSaverPref } from '@/lib/data-saver-pref';
import { useT } from '@/lib/i18n';
import { storage } from '@/lib/storage';

/**
 * Speed g4: the first time the phone is on a slow connection, say once that low-data mode exists, with
 * one tap to keep it on. Never again after that (the settings row stays the place to change it).
 */
export function LiteHint() {
  const { slow } = useDataSaver();
  const toast = useToast();
  const t = useT();
  const busy = useRef(false);

  useEffect(() => {
    if (!slow || busy.current) return;
    busy.current = true;
    let live = true;
    void (async () => {
      const [pref, shown] = await Promise.all([dataSaverLoaded(), storage.getItem(LITE_HINT_KEY).catch(() => null)]);
      const hint = liteHintFor(pref, true, shown !== null);
      if (!live || !hint) return;
      await storage.setItem(LITE_HINT_KEY, '1').catch(() => undefined);
      toast.show({
        message: t(hint === 'auto' ? 'datasaver.slow_hint_auto' : 'datasaver.slow_hint_off'),
        tone: 'info',
        icon: 'wifi',
        action: { label: t(hint === 'auto' ? 'datasaver.slow_keep' : 'datasaver.slow_turn_on'), onPress: () => void saveDataSaverPref('on') },
      });
    })().finally(() => {
      busy.current = false;
    });
    return () => {
      live = false;
    };
  }, [slow, toast, t]);

  return null;
}
