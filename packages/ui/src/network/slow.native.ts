import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/** Native: a 2G/3G mobile connection counts as slow (Wi-Fi and 4G/5G do not). */
function slow(state: NetInfoState): boolean {
  if (state.type !== 'cellular') return false;
  const gen = state.details?.cellularGeneration ?? null;
  return gen === '2g' || gen === '3g';
}

export function subscribeSlow(onChange: (slow: boolean) => void): () => void {
  void NetInfo.fetch().then((s) => onChange(slow(s)));
  return NetInfo.addEventListener((s) => onChange(slow(s)));
}
