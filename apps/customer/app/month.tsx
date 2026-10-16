import { useLocalSearchParams } from 'expo-router';
import { GuestGate } from '@/components/GuestGate';
import { StatsScreen } from '@/features/stats/StatsScreen';
import { useSignedIn } from '@/lib/session';

/**
 * «دفترك ويا درايفر» (stats & savings, 2026-10-11; it took over «شهرك» at the same address): opened
 * from the wallet, the account and the month-start card (`?month=` opens that month).
 */
export default function MonthPage() {
  const params = useLocalSearchParams<{ month?: string }>();
  return useSignedIn() ? <StatsScreen initialMonth={params.month} /> : <GuestGate kind="wallet" />;
}
