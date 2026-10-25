import { CustomerProfile } from '@/components/people/customer-profile';
import { safeDecode } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CustomerProfile personId={safeDecode(id)} />;
}
