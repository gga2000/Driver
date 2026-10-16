import { Redirect } from 'expo-router';

/** The numbers live inside «يومك» since counter step 5 (g1); old links land on that tab. */
export default function InsightsRedirect() {
  return <Redirect href={{ pathname: '/money', params: { tab: 'insights' } }} />;
}
