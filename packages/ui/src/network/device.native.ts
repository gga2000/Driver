import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * What the device says about its network — native: NetInfo. "Connected to Wi-Fi with no internet"
 * (`isInternetReachable === false`) counts as offline (the monitor still checks the API every 15 s, so a
 * wrong "no internet" on a captive Wi-Fi ends on its own, CORE-14); an unknown reachability (null, right after a
 * change) does not, so a slow check never flashes the strip. The API probe settles the rest.
 */
function online(state: NetInfoState): boolean {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

export function deviceOnlineNow(): boolean {
  return true;
}

export function subscribeDevice(onChange: (online: boolean) => void): () => void {
  void NetInfo.fetch().then((s) => onChange(online(s)));
  return NetInfo.addEventListener((s) => onChange(online(s)));
}
