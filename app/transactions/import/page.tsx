import { Suspense } from 'react';
import { GmailImportView } from '@/components/transactions/gmail-import-view';

export default function GmailImportPage() {
  return (
    <Suspense fallback={null}>
      <GmailImportView />
    </Suspense>
  );
}
