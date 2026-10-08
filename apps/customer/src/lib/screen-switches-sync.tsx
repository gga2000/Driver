import { useEffect } from 'react';
import { useApiClient } from './api';
import { useSession } from './session';
import { buildDecides, screenSwitches } from './ui-switches';

/** The city whose screen switches this app reads (one city at launch). */
const SWITCH_CITY = 'aziziyah';

/**
 * Asks the server which redesigned screens to show (`system.screens`) once the session is known at
 * start, and again after each sign-in or sign-out (staff see screens switched on for staff). A failed
 * read changes nothing: the saved answer or the old screens stay. Draws nothing.
 */
export function ScreenSwitchesSync() {
  const client = useApiClient();
  const { status } = useSession();
  useEffect(() => {
    if (status === 'loading' || buildDecides()) return;
    let live = true;
    client.system.screens
      .query({ cityId: SWITCH_CITY })
      .then((answer) => (live ? screenSwitches.apply(answer) : undefined))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, status]);
  return null;
}
