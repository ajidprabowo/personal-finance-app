import { Suspense } from 'react';
import { TransactionsView } from '@/components/transactions/transactions-view';

export default function TransactionsPage() {
  return (
    <Suspense fallback={null}>
      <TransactionsView />
    </Suspense>
  );
}

