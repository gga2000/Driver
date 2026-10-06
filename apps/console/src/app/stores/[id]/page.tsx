import { StoresPage } from '@/components/stores-page';
import { safeDecode } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoresPage storeId={safeDecode(id)} />;
}
