import { DriverProfile } from '@/components/people/driver-profile';
import { safeDecode } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DriverProfile personId={safeDecode(id)} />;
}
