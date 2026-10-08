import * as Brightness from 'expo-brightness';
import { useEffect } from 'react';
import { Platform } from 'react-native';

/**
 * Partner redesign j5: the screen at full brightness while the pickup code fills it (a counter in the
 * sun, a scratched phone), back to what it was after. Only this app's window — no system setting, no
 * permission.
 */
export function useFullBrightness(on: boolean): void {
  useEffect(() => {
    if (!on) return;
    let before: number | null = null;
    let alive = true;
    void (async () => {
      try {
        before = await Brightness.getBrightnessAsync();
        if (alive) await Brightness.setBrightnessAsync(1);
      } catch {
        // No brightness control on this phone: the big code still shows.
      }
    })();
    return () => {
      alive = false;
      void (async () => {
        try {
          if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
          else if (before !== null) await Brightness.setBrightnessAsync(before);
        } catch {
          // Nothing to restore.
        }
      })();
    };
  }, [on]);
}
