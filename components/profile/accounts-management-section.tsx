'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, ArrowUpRight, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { SettingsSection } from '@/components/ui/settings-section';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useI18n } from '@/hooks/use-i18n';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import { formatDisplayDate } from '@/lib/dates';
import {
  createUserAccount,
  deleteUserAccountSafely,
  listUserAccountsWithBalances,
  toggleUserAccountArchive,
  updateUserAccount,
  type UserAccountWithBalance,
} from '@/services/settings.service';
import type { Account, AccountType } from '@/types/entities';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: 'Bank Account',
  cash: 'Cash',
  ewallet: 'E-Wallet',
  investment_pool: 'Investment Pool',
  investment_cash: 'Platform Cash',
  credit_card: 'Credit Card',
  other: 'Other',
};

type AccountStatusFilter = 'active' | 'archived' | 'all';

export function AccountsManagementSection() {
  const { preferences } = useBootstrap();
  const { t } = useI18n();
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError } = useNotifications();

  const [accountBalances, setAccountBalances] = useState<UserAccountWithBalance[]>([]);
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>('active');
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('bank');
  const [currency, setCurrency] = useState<string>(APP_CONFIG.defaultCurrency);
  const [initialBalanceInput, setInitialBalanceInput] = useState('0');
  const [notes, setNotes] = useState('');
  const [isArchived, setIsArchived] = useState(false);

  const numberFormat = preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  const reload = useCallback(async () => {
    try {
      const items = await listUserAccountsWithBalances();
      setAccountBalances(items);
    } catch (error) {
      notifyError('Failed to load accounts', error);
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    let active = true;
    listUserAccountsWithBalances()
      .then((items) => {
        if (active) setAccountBalances(items);
      })
      .catch((error) => {
        if (active) notifyError('Failed to load accounts', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const filteredAccounts = useMemo(() => {
    return accountBalances.filter((item) => {
      if (statusFilter === 'active') return !item.account.isArchived;
      if (statusFilter === 'archived') return item.account.isArchived;
      return true;
    });
  }, [accountBalances, statusFilter]);

  const openAddModal = () => {
    setEditingAccount(null);
    setName('');
    setType('bank');
    setCurrency(preferences?.baseCurrency ?? APP_CONFIG.defaultCurrency);
    setInitialBalanceInput('0');
    setNotes('');
    setIsArchived(false);
    setModalOpen(true);
  };

  const openEditModal = (acc: Account) => {
    setEditingAccount(acc);
    setName(acc.name);
    setType(acc.type);
    setCurrency(acc.currency);
    setInitialBalanceInput(String(acc.initialBalance ?? 0));
    setNotes(acc.notes ?? '');
    setIsArchived(acc.isArchived);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedOpening = initialBalanceInput.trim() === '' ? 0 : Number(initialBalanceInput);
    if (!Number.isFinite(parsedOpening)) {
      notifyError('Invalid opening balance', 'Please enter a valid numeric opening balance.');
      return;
    }

    setSaving(true);
    try {
      if (editingAccount) {
        await updateUserAccount(editingAccount.id, {
          name,
          type,
          currency,
          initialBalance: parsedOpening,
          notes,
          isArchived,
        });
        notifySuccess('Account updated', `Saved changes to "${name.trim()}".`);
      } else {
        await createUserAccount({
          name,
          type,
          currency,
          initialBalance: parsedOpening,
          notes,
          isArchived,
        });
        notifySuccess('Account added', `Created "${name.trim()}" in local accounts table.`);
      }
      setModalOpen(false);
      await reload();
    } catch (error) {
      notifyError('Could not save account', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleArchive = async (acc: Account) => {
    try {
      const nextArchived = !acc.isArchived;
      await toggleUserAccountArchive(acc.id, nextArchived);
      notifySuccess(
        nextArchived ? 'Account archived' : 'Account reactivated',
        nextArchived
          ? `"${acc.name}" is now archived. Historical transactions remain intact.`
          : `"${acc.name}" is active again for new transactions.`
      );
      await reload();
    } catch (error) {
      notifyError('Failed to update account status', error);
    }
  };

  const handleDeleteAccount = async (item: UserAccountWithBalance) => {
    const acc = item.account;
    const approved = await confirm({
      title: 'Delete Account',
      description:
        item.transactionCount > 0
          ? `"${acc.name}" currently has ${item.transactionCount} linked transaction(s). Deleting accounts with history is blocked; archive it instead if no longer active.`
          : `Permanently delete "${acc.name}" from your local accounts table?`,
      confirmLabel: 'Delete Account',
      tone: 'danger',
    });
    if (!approved) return;

    try {
      await deleteUserAccountSafely(acc.id);
      notifySuccess('Account deleted', `Removed "${acc.name}".`);
      await reload();
    } catch (error) {
      notifyError('Cannot delete account', error);
    }
  };

  const isLinkedPlatformCash = Boolean(
    editingAccount?.type === 'investment_cash' && editingAccount.platformId
  );

  return (
    <>
      <SettingsSection
        id="accounts"
        title={t('settings.section.accounts')}
        description="Manage bank accounts, cash, e-wallets, credit cards, investment pools, and opening balances."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter accounts by status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AccountStatusFilter)}
              options={[
                { value: 'active', label: `${t('common.active')} (${accountBalances.filter((a) => !a.account.isArchived).length})` },
                { value: 'archived', label: `${t('common.archived')} (${accountBalances.filter((a) => a.account.isArchived).length})` },
                { value: 'all', label: `${t('common.all')} (${accountBalances.length})` },
              ]}
            />
            <Button variant="outline" size="sm" onClick={openAddModal}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Add Account</span>
            </Button>
          </div>
        }
      >
        {loading ? (
          <div className="px-5 py-6 text-xs text-ink-muted">{t('common.loading')}</div>
        ) : filteredAccounts.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <p className="text-sm font-medium text-ink">
              {statusFilter === 'archived'
                ? 'No archived accounts'
                : 'No financial accounts match this filter'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Add your bank, cash, e-wallet, or investment pool accounts to start recording transactions.
            </p>
          </div>
        ) : (
          filteredAccounts.map((item) => {
            const acc = item.account;
            const isPlatformCash = acc.type === 'investment_cash' && Boolean(acc.platformId);
            return (
              <div
                key={acc.id}
                className="flex flex-col justify-between gap-3 px-5 py-3.5 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-ink">{acc.name}</p>
                    <span
                      className={
                        acc.isArchived
                          ? 'rounded border border-status-warning/30 bg-status-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-status-warning'
                          : 'rounded border border-status-success/30 bg-status-success/10 px-1.5 py-0.5 text-[11px] font-medium text-status-success'
                      }
                    >
                      {acc.isArchived ? t('common.archived') : t('common.active')}
                    </span>
                    {isPlatformCash ? (
                      <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-muted">
                        Linked Platform Cash
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-ink-muted">
                    <span>{ACCOUNT_TYPE_LABELS[acc.type] ?? acc.type}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">{acc.currency}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Opening: {formatCurrency(item.openingBalance, acc.currency, numberFormat)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{item.transactionCount} tx</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Created: {formatDisplayDate(acc.createdAt, dateFormat)}
                    </span>
                  </div>
                  {acc.notes ? (
                    <p className="mt-1 truncate text-xs text-ink-muted">{acc.notes}</p>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-3 sm:justify-end">
                  <div className="text-left sm:text-right">
                    <p className="text-[11px] uppercase tracking-wider text-ink-muted">
                      Current Balance
                    </p>
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {formatCurrency(item.currentBalance, acc.currency, numberFormat)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Link
                      href={`/transactions?accountId=${encodeURIComponent(acc.id)}`}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-muted"
                      title={`View transactions for ${acc.name}`}
                    >
                      <span>History</span>
                      <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                    </Link>

                    <IconButton
                      label={`Edit ${acc.name}`}
                      variant="outline"
                      size="sm"
                      onClick={() => openEditModal(acc)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </IconButton>

                    {!isPlatformCash ? (
                      <>
                        <IconButton
                          label={acc.isArchived ? `Restore ${acc.name}` : `Archive ${acc.name}`}
                          variant="outline"
                          size="sm"
                          onClick={() => void handleToggleArchive(acc)}
                        >
                          {acc.isArchived ? (
                            <RotateCcw className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                        </IconButton>

                        <IconButton
                          label={`Delete ${acc.name}`}
                          variant="danger"
                          size="sm"
                          onClick={() => void handleDeleteAccount(item)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </SettingsSection>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingAccount ? 'Edit Account' : 'Add Account'}
        description="Current balance is automatically derived from the opening balance plus posted transactions."
      >
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {isLinkedPlatformCash ? (
            <div className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-ink-muted">
              This account is linked to an Investment Platform. Platform Cash type and deletion are managed under Investment Platforms.
            </div>
          ) : null}

          <Input
            label="Account Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. BCA Main Checking"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Account Type"
              value={type}
              disabled={isLinkedPlatformCash}
              onChange={(e) => setType(e.target.value as AccountType)}
              options={
                isLinkedPlatformCash
                  ? [{ value: 'investment_cash', label: 'Platform Cash' }]
                  : [
                      { value: 'bank', label: 'Bank Account' },
                      { value: 'cash', label: 'Cash' },
                      { value: 'ewallet', label: 'E-Wallet' },
                      { value: 'credit_card', label: 'Credit Card' },
                      { value: 'investment_pool', label: 'Investment Pool' },
                      { value: 'other', label: 'Other' },
                    ]
              }
            />

            <Select
              label="Currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              options={APP_CONFIG.supportedCurrencies.map((c) => ({
                value: c.code,
                label: `${c.code} — ${c.name}`,
              }))}
            />
          </div>

          <Input
            label={`Opening Balance (${currency})`}
            type="number"
            step="any"
            value={initialBalanceInput}
            onChange={(e) => setInitialBalanceInput(e.target.value)}
            helperText="Starting balance prior to recorded transactions."
          />

          <Input
            label={`Description / Notes (${t('common.optional')})`}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Primary household payroll account"
          />

          <Select
            label="Account Status"
            value={isArchived ? 'archived' : 'active'}
            disabled={isLinkedPlatformCash}
            onChange={(e) => setIsArchived(e.target.value === 'archived')}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived / Inactive' },
            ]}
          />

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {editingAccount ? t('common.saveChanges') : 'Create Account'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
