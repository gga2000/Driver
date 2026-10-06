import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl } from 'react-native';
import type { DriverDocumentKind } from '@driver/contracts';
import { Card, EmptyState, Skeleton } from '@driver/ui';
import { Screen } from '@/components/Screen';
import { DocsSection, DocsSummaryCard, UploadDocumentSheet } from '@/features/account/DocumentParts';
import { documentRows } from '@/features/account/logic';
import { useDocuments } from '@/features/account/queries';
import { apiErrorMessage } from '@/lib/api';
import { useLocale, useT } from '@/lib/i18n';

/**
 * المستمسكات (scoring §2): every paper he has or needs, most urgent first — expired (keeps him
 * offline), rejected with the reason, missing, expiring with the days left, under review, approved —
 * and the upload sheet (photo → signed upload → `driverAccount.uploadDocument`); the personal photo
 * opens صورتك الرئيسية (/photo), the photo customers see.
 */
export default function Documents() {
  const t = useT();
  const locale = useLocale();
  const q = useDocuments();
  const [uploading, setUploading] = useState<DriverDocumentKind | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const view = q.data;
  const rows = view ? documentRows(view) : [];
  // The personal photo is his main photo customers see (Ali, 2026-10-06): its own screen, with the face guide.
  const upload = (kind: DriverDocumentKind) => (kind === 'photo' ? router.push('/photo') : setUploading(kind));
  return (
    <Screen
      testID="documents"
      edges={['bottom']}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void q.refetch().finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Stack.Screen options={{ title: t('partner.hub_documents') }} />
      {!view ? (
        q.error ? (
          <EmptyState icon="receipt" title={apiErrorMessage(q.error, t('error.network'), locale)} action={{ label: t('action.retry'), onPress: () => void q.refetch() }} />
        ) : (
          <Card elevation={1} padding={5}>
            <Skeleton lines={6} />
          </Card>
        )
      ) : (
        <>
          <DocsSummaryCard view={view} />
          <DocsSection title={t('partner.docs_section_required')} rows={rows.filter((r) => r.required)} onUpload={upload} />
          <DocsSection title={t('partner.docs_section_other')} rows={rows.filter((r) => !r.required)} onUpload={upload} />
        </>
      )}
      <UploadDocumentSheet kind={uploading} onClose={() => setUploading(null)} />
    </Screen>
  );
}
