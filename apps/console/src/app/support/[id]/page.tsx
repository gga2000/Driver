import { SupportCasePage } from '@/components/support-case';
import { safeDecode } from '@/lib/format';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupportCasePage ticketId={safeDecode(id)} />;
}
