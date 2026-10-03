import { useLocalSearchParams } from 'expo-router';
import { PlaceholderScreen } from '@/components/PlaceholderScreen';
import { FIXTURE_RESTAURANTS } from '@/fixtures/restaurants';

/** STUB — the food-ordering milestone replaces this file with the restaurant page (spec §3). */
export default function RestaurantStub() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const name = FIXTURE_RESTAURANTS.find((r) => r.id === id)?.name ?? id ?? '';
  return <PlaceholderScreen title={name} icon="bag" detail={`/restaurant/${id ?? ''}`} />;
}
