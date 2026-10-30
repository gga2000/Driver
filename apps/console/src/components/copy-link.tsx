'use client';

import { t } from '@driver/i18n';
import { Button, IconCopy, useToast } from './ui';

/** «انسخ الرابط»: the page's link with its filters (v3), to send to a teammate. */
export function CopyLinkButton() {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<IconCopy size={15} />}
      onClick={() => {
        const href = window.location.href;
        void navigator.clipboard?.writeText(href).then(
          () => toast({ title: t('console.link_copied') }),
          () => toast({ title: t('console.link_copy_failed'), tone: 'bad' }),
        );
      }}
    >
      {t('console.copy_link')}
    </Button>
  );
}
