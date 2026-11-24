'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { todayDateString } from '@/lib/dates';
import { normalizeErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { listUserSubcategories } from '@/services/settings.service';
import { createTransaction, updateTransaction } from '@/services/transaction.service';
import type {
  Account,
  Category,
  Subcategory,
  Transaction,
  TransactionType,
} from '@/types/entities';

export interface TransactionFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  accounts: Account[];
  categories: Category[];
  subcategories?: Subcategory[];
  timezone?: string;
  initialTransaction?: Transaction | null;
}

const TYPE_OPTIONS: Array<{
  value: TransactionType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'expense', label: 'Expense', icon: ArrowUpRight },
  { value: 'income', label: 'Income', icon: ArrowDownLeft },
  { value: 'transfer', label: 'Transfer', icon: ArrowLeftRight },
];

interface TransactionFormBodyProps {
  onClose: () => void;
  onSaved: () => Promise<void> | void;
  accounts: Account[];
  categories: Category[];
  subcategories?: Subcategory[];
  timezone: string;
  initialTransaction: Transaction | null;
}

function TransactionFormBody({
  onClose,
  onSaved,
  accounts,
  categories,
  subcategories,
  timezone,
  initialTransaction,
}: TransactionFormBodyProps) {
  const { notifySuccess } = useNotifications();
  const isEditing = Boolean(initialTransaction);

  const selectableAccounts = useMemo(() => {
    return accounts.filter(
      (acc) =>
        !acc.isArchived ||
        acc.id === initialTransaction?.accountId ||
        acc.id === initialTransaction?.toAccountId
    );
  }, [accounts, initialTransaction]);

  const activeAccounts = useMemo(
    () => accounts.filter((acc) => !acc.isArchived),
    [accounts]
  );

  const initialType: TransactionType = initialTransaction?.type ?? 'expense';
  const defaultAccountId =
    initialTransaction?.accountId ?? activeAccounts[0]?.id ?? selectableAccounts[0]?.id ?? '';
  const defaultDestAccountId =
    initialTransaction?.toAccountId ??
    activeAccounts.find((a) => a.id !== defaultAccountId)?.id ??
    selectableAccounts.find((a) => a.id !== defaultAccountId)?.id ??
    '';

  const getDefaultCategoryId = (targetType: TransactionType, preferredId?: string): string => {
    if (targetType === 'transfer') return '';
    const matching = categories.filter(
      (c) => c.kind === targetType && (!c.isArchived || c.id === preferredId)
    );
    if (preferredId && matching.some((c) => c.id === preferredId)) {
      return preferredId;
    }
    return matching[0]?.id ?? '';
  };

  const [type, setType] = useState<TransactionType>(initialType);
  const [amountInput, setAmountInput] = useState<string>(
    initialTransaction ? String(initialTransaction.amount) : ''
  );
  const [date, setDate] = useState<string>(
    initialTransaction?.date ?? todayDateString(timezone)
  );
  const [accountId, setAccountId] = useState<string>(defaultAccountId);
  const [toAccountId, setToAccountId] = useState<string>(defaultDestAccountId);
  const [categoryId, setCategoryId] = useState<string>(() =>
    getDefaultCategoryId(initialType, initialTransaction?.categoryId)
  );
  const [subcategoryId, setSubcategoryId] = useState<string>(
    initialTransaction?.subcategoryId ?? ''
  );
  const [loadedSubcategories, setLoadedSubcategories] = useState<Subcategory[]>([]);
  const [description, setDescription] = useState<string>(
    initialTransaction?.description ?? ''
  );
  const [notes, setNotes] = useState<string>(initialTransaction?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (subcategories !== undefined) return;
    let active = true;
    listUserSubcategories()
      .then((rows) => {
        if (active) setLoadedSubcategories(rows);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [subcategories]);

  const effectiveSubcategories = subcategories ?? loadedSubcategories;

  const filteredCategories = useMemo(() => {
    if (type === 'transfer') return [];
    return categories.filter(
      (c) =>
        c.kind === type &&
        (!c.isArchived || (isEditing && c.id === initialTransaction?.categoryId))
    );
  }, [categories, type, isEditing, initialTransaction?.categoryId]);

  const matchingSubcategories = useMemo(() => {
    if (type === 'transfer' || !categoryId) return [];
    return effectiveSubcategories.filter(
      (s) =>
        s.categoryId === categoryId &&
        (!s.isArchived || (isEditing && s.id === initialTransaction?.subcategoryId))
    );
  }, [effectiveSubcategories, type, categoryId, isEditing, initialTransaction?.subcategoryId]);
  const hasValidSelectedSubcategory =
    type !== 'transfer' && matchingSubcategories.some((s) => s.id === subcategoryId);

  const sourceAccount = selectableAccounts.find((a) => a.id === accountId);
  const destinationOptions = useMemo(
    () => selectableAccounts.filter((a) => a.id !== accountId),
    [selectableAccounts, accountId]
  );

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType);
    setFormError(null);
    if (nextType === 'transfer') {
      if (!toAccountId || toAccountId === accountId) {
        const alt = selectableAccounts.find(
          (a) => a.id !== accountId && a.currency === (sourceAccount?.currency ?? a.currency)
        ) ?? selectableAccounts.find((a) => a.id !== accountId);
        setToAccountId(alt?.id ?? '');
      }
    } else {
      const stillValid = categories.some(
        (c) =>
          c.id === categoryId &&
          c.kind === nextType &&
          (!c.isArchived || (isEditing && c.id === initialTransaction?.categoryId))
      );
      if (!stillValid) {
        setCategoryId(getDefaultCategoryId(nextType, initialTransaction?.categoryId));
        setSubcategoryId('');
      }
    }
  };

  const handleSourceAccountChange = (nextSourceId: string) => {
    setAccountId(nextSourceId);
    setFormError(null);
    if (type === 'transfer' && toAccountId === nextSourceId) {
      const alt = selectableAccounts.find((a) => a.id !== nextSourceId);
      setToAccountId(alt?.id ?? '');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    setFormError(null);
    const parsedAmount = Number(amountInput);
    if (!amountInput.trim() || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid amount greater than zero.');
      return;
    }

    if (selectableAccounts.length === 0) {
      setFormError('You need at least one active account before creating transactions.');
      return;
    }

    const validSubId =
      type !== 'transfer' && matchingSubcategories.some((s) => s.id === subcategoryId)
        ? subcategoryId
        : undefined;
    if (type !== 'transfer' && !validSubId && !description.trim()) {
      setFormError('Description is required unless you select a subcategory.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        type,
        amount: parsedAmount,
        date,
        accountId,
        toAccountId: type === 'transfer' ? toAccountId : undefined,
        categoryId: type === 'transfer' ? undefined : categoryId,
        subcategoryId: validSubId,
        description: description.trim(),
        notes: notes.trim() || undefined,
      };

      if (initialTransaction) {
        await updateTransaction(initialTransaction.id, payload, { recordOrigin: 'user' });
        notifySuccess('Transaction updated', 'Saved changes and recalculated account balances.');
      } else {
        await createTransaction(payload, { recordOrigin: 'user' });
        notifySuccess(
          type === 'transfer' ? 'Transfer recorded' : 'Transaction recorded',
          'Saved to local ledger and updated account balances.'
        );
      }

      await onSaved();
      onClose();
    } catch (error) {
      setFormError(normalizeErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  if (selectableAccounts.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-surface-muted p-4 text-sm text-ink-muted">
          No active financial accounts found. Create an account first in Profile &amp; Settings so
          transactions can update an account balance.
        </div>
        <div className="flex items-center justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Link href="/profile#accounts" onClick={onClose}>
            <Button>Go to Account Settings</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div>
        <span className="mb-1.5 block text-xs font-medium text-ink">Transaction Type</span>
        <div
          role="radiogroup"
          aria-label="Transaction Type"
          className="grid grid-cols-3 gap-1.5 rounded-lg border border-line bg-surface-muted p-1"
        >
          {TYPE_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const selected = type === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleTypeChange(opt.value)}
                className={cn(
                  'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent',
                  selected
                    ? 'bg-surface text-ink shadow-sm ring-1 ring-line'
                    : 'text-ink-muted hover:text-ink'
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-status-danger/40 bg-status-danger/10 px-3.5 py-2.5 text-xs text-status-danger"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label={`Amount (${sourceAccount?.currency ?? APP_CONFIG.defaultCurrency})`}
          type="number"
          min="0"
          step="any"
          required
          value={amountInput}
          onChange={(e) => {
            setAmountInput(e.target.value);
            if (formError) setFormError(null);
          }}
          placeholder="0"
          className="tabular-nums"
        />

        <Input
          label="Date"
          type="date"
          required
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            if (formError) setFormError(null);
          }}
          className="tabular-nums"
        />
      </div>

      {type === 'transfer' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Source Account"
            value={accountId}
            onChange={(e) => handleSourceAccountChange(e.target.value)}
            options={selectableAccounts.map((acc) => ({
              value: acc.id,
              label: `${acc.name} (${acc.currency})${acc.isArchived ? ' [Archived]' : ''}`,
            }))}
          />

          <Select
            label="Destination Account"
            value={toAccountId}
            onChange={(e) => {
              setToAccountId(e.target.value);
              if (formError) setFormError(null);
            }}
            options={
              destinationOptions.length > 0
                ? destinationOptions.map((acc) => ({
                    value: acc.id,
                    label: `${acc.name} (${acc.currency})${acc.isArchived ? ' [Archived]' : ''}`,
                  }))
                : [{ value: '', label: 'Add a second account to transfer' }]
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Account"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              if (formError) setFormError(null);
            }}
            options={selectableAccounts.map((acc) => ({
              value: acc.id,
              label: `${acc.name} (${acc.currency})${acc.isArchived ? ' [Archived]' : ''}`,
            }))}
          />

          <Select
            label="Category"
            value={categoryId}
            onChange={(e) => {
              const nextCat = e.target.value;
              setCategoryId(nextCat);
              setSubcategoryId((prev) =>
                effectiveSubcategories.some((s) => s.id === prev && s.categoryId === nextCat)
                  ? prev
                  : ''
              );
              if (formError) setFormError(null);
            }}
            options={
              filteredCategories.length > 0
                ? filteredCategories.map((cat) => ({
                    value: cat.id,
                    label: `${cat.name}${cat.isArchived ? ' [Archived]' : ''}`,
                  }))
                : [{ value: '', label: `No ${type} categories available` }]
            }
          />
        </div>
      )}

      {type !== 'transfer' && matchingSubcategories.length > 0 ? (
        <Select
          label="Subcategory (Optional)"
          value={subcategoryId}
          onChange={(e) => setSubcategoryId(e.target.value)}
          options={[
            { value: '', label: 'None' },
            ...matchingSubcategories.map((sub) => ({
              value: sub.id,
              label: `${sub.name}${sub.isArchived ? ' [Archived]' : ''}`,
            })),
          ]}
        />
      ) : null}

      <Input
        label={
          type === 'transfer' || hasValidSelectedSubcategory
            ? 'Description (optional)'
            : 'Description'
        }
        required={type !== 'transfer' && !hasValidSelectedSubcategory}
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          if (formError) setFormError(null);
        }}
        placeholder={
          type === 'transfer'
            ? 'e.g. Top up E-Wallet from Bank'
            : type === 'income'
              ? 'e.g. Monthly Salary'
              : 'e.g. Weekly Groceries'
        }
      />

      <div>
        <label htmlFor="tx-notes-input" className="mb-1.5 block text-xs font-medium text-ink">
          Notes (optional)
        </label>
        <textarea
          id="tx-notes-input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional memo or reference details..."
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted/70 transition-colors focus-visible:border-brand-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        />
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={saving}
          disabled={type === 'transfer' && destinationOptions.length === 0}
        >
          {isEditing ? 'Save Changes' : type === 'transfer' ? 'Record Transfer' : 'Save Transaction'}
        </Button>
      </div>
    </form>
  );
}

export function TransactionFormModal({
  open,
  onClose,
  onSaved,
  accounts,
  categories,
  subcategories,
  timezone = APP_CONFIG.defaultTimezone,
  initialTransaction = null,
}: TransactionFormModalProps) {
  const formKey = `${open ? 'open' : 'closed'}-${initialTransaction?.id ?? 'new'}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initialTransaction ? 'Edit Transaction' : 'Add Transaction'}
      description={
        initialTransaction
          ? 'Editing a transaction atomically recalculates affected account balances.'
          : 'Record income, expense, or an internal account transfer locally in IndexedDB.'
      }
      maxWidthClassName="max-w-lg"
    >
      {open ? (
        <TransactionFormBody
          key={formKey}
          onClose={onClose}
          onSaved={onSaved}
          accounts={accounts}
          categories={categories}
          subcategories={subcategories}
          timezone={timezone}
          initialTransaction={initialTransaction}
        />
      ) : null}
    </Modal>
  );
}
