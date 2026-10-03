import { OrderDetail } from '@/components/order-detail';
import { safeDecode } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetail orderId={safeDecode(id)} />;
}
