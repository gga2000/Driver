import { DriverLedger } from '@/components/driver-ledger';
import { safeDecode } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverLedger driverId={safeDecode(id)} />;
}
