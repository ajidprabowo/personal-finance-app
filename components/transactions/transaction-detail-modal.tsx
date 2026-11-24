'use client';

import React, { useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import { formatDisplayDate, formatTimestamp } from '@/lib/dates';
import { cn } from '@/lib/utils';
import {
  deleteTransaction,
  type EnrichedTransactionItem,
} from '@/services/transaction.service';
import type { DateFormatPreference, NumberFormatPreference } from '@/types/entities';

export interface TransactionDetailModalProps {
  item: EnrichedTransactionItem | null;
  onClose: () => void;
  onEdit: (item: EnrichedTransactionItem) => void;
  onDeleted: () => Promise<void> | void;
  numberFormat?: NumberFormatPreference;
  dateFormat?: DateFormatPreference;
  timezone?: string;
}

export function TransactionDetailModal({
  item,
  onClose,
  onEdit,
  onDeleted,
  numberFormat = APP_CONFIG.defaultNumberFormat,
  dateFormat = APP_CONFIG.defaultDateFormat,
  timezone = APP_CONFIG.defaultTimezone,
}: TransactionDetailModalProps) {
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();
  const [deleting, setDeleting] = useState(false);

  const tx = item?.transaction;

  const handleDelete = async () => {
    if (!item || !tx) return;
    const isTransfer = tx.type === 'transfer';
    const approved = await confirm({
      title: isTransfer ? 'Delete Internal Transfer' : 'Delete Transaction',
      description: isTransfer
        ? `Delete transfer "${tx.description}" (${formatCurrency(tx.amount, tx.currency, numberFormat)})? Both source and destination account balances will be restored.`
        : `Delete "${tx.description}" (${formatCurrency(tx.amount, tx.currency, numberFormat)})? Account balance will be updated automatically.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!approved) return;

    setDeleting(true);
    try {
      await deleteTransaction(tx.id, { recordOrigin: 'user' });
      notifySuccess(
        isTransfer ? 'Transfer deleted' : 'Transaction deleted',
        'Account balances and financial summaries have been updated.'
      );
      await onDeleted();
      onClose();
    } catch (error) {
      notifyError('Failed to delete transaction', error);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title="Transaction Details"
      description="Local ledger record stored in IndexedDB."
      maxWidthClassName="max-w-lg"
    >
      {item && tx ? (
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-muted p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium capitalize',
                    tx.type === 'income'
                      ? 'bg-status-success/10 text-status-success'
                      : tx.type === 'expense'
                        ? 'bg-status-danger/10 text-status-danger'
                        : 'bg-brand-secondary/10 text-brand-secondary'
                  )}
                >
                  {tx.type === 'income' ? (
                    <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : tx.type === 'expense' ? (
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {tx.type}
                </span>
                <span className="text-xs font-mono text-ink-muted">{tx.currency}</span>
              </div>
              <p className="mt-2 text-sm font-semibold text-ink">{tx.description}</p>
            </div>
            <p
              className={cn(
                'shrink-0 text-xl font-semibold tabular-nums',
                tx.type === 'income'
                  ? 'text-status-success'
                  : tx.type === 'expense'
                    ? 'text-status-danger'
                    : 'text-ink'
              )}
            >
              {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
              {formatCurrency(tx.amount, tx.currency, numberFormat)}
            </p>
          </div>

          <dl className="divide-y divide-line rounded-xl border border-line bg-surface text-sm">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-ink-muted">Date</dt>
              <dd className="font-medium tabular-nums text-ink">
                {formatDisplayDate(tx.date, dateFormat)}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-ink-muted">Category</dt>
              <dd className="font-medium text-ink">
                {item.categoryName}
                {item.subcategoryName ? (
                  <span className="text-ink-muted"> / {item.subcategoryName}</span>
                ) : null}
                {item.categoryArchived ? (
                  <span className="ml-2 text-xs text-status-warning">(Archived)</span>
                ) : null}
              </dd>
            </div>

            {tx.type === 'transfer' ? (
              <>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-xs text-ink-muted">Source Account</dt>
                  <dd className="font-medium text-ink">{item.accountName}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <dt className="text-xs text-ink-muted">Destination Account</dt>
                  <dd className="font-medium text-ink">{item.destinationAccountName ?? '—'}</dd>
                </div>
                {tx.transferGroupId ? (
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <dt className="text-xs text-ink-muted">Transfer Group</dt>
                    <dd className="font-mono text-xs text-ink-muted">{tx.transferGroupId}</dd>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-xs text-ink-muted">Account</dt>
                <dd className="font-medium text-ink">{item.accountName}</dd>
              </div>
            )}

            <div className="flex items-start justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-ink-muted">Notes</dt>
              <dd className="max-w-xs text-right text-xs leading-relaxed text-ink">
                {tx.notes ? tx.notes : <span className="text-ink-muted">No notes</span>}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-ink-muted">Created At</dt>
              <dd className="font-mono text-xs tabular-nums text-ink-muted">
                {formatTimestamp(tx.createdAt, timezone)}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-xs text-ink-muted">Last Updated</dt>
              <dd className="font-mono text-xs tabular-nums text-ink-muted">
                {formatTimestamp(tx.updatedAt, timezone)}
              </dd>
            </div>
          </dl>

          <div className="flex items-center justify-between gap-3 pt-1">
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Delete</span>
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={deleting}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={deleting}
                onClick={() => {
                  onClose();
                  onEdit(item);
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Edit</span>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
