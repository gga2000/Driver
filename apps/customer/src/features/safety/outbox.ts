import { AppState } from 'react-native';
import { getNetwork } from '@driver/ui';
import { storage } from '@/lib/storage';
import { createSosOutbox } from './sos-outbox';

/**
 * The app's one SOS outbox (FLOW-05): a press that hasn't got through keeps trying after the sheet is
 * closed or the trip screen left, tries at once when the network or the app comes back, and is kept
 * on the phone (secure storage) so it is sent again after the app was killed.
 */
export const sosOutbox = createSosOutbox({ storage });
getNetwork().subscribe(() => {
  if (getNetwork().getSnapshot().state === 'online') sosOutbox.nudge();
});
AppState.addEventListener('change', (s) => {
  if (s === 'active') sosOutbox.nudge();
});
