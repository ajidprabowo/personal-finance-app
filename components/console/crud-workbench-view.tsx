'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { useConfirmDialog } from '@/hooks/use-confirm-dialog';
import { useNotifications } from '@/hooks/use-notifications';
import { formatCurrency } from '@/lib/currency';
import { formatTimestamp, todayDateString } from '@/lib/dates';
import {
  clearAllVerificationTestData,
  createTestAccount,
  createTestCategory,
  createTestTransaction,
  deleteTestAccount,
  deleteTestCategory,
  deleteTestTransaction,
  listVerificationTestData,
  updateTestAccount,
  updateTestCategory,
  updateTestTransaction,
} from '@/services/crud-verification.service';
import type {
  Account,
  AccountType,
  Category,
  CategoryKind,
  Transaction,
  TransactionType,
} from '@/types/entities';

type ActiveEntityTab = 'accounts' | 'categories' | 'transactions';

export function CrudWorkbenchView() {
  const { confirm } = useConfirmDialog();
  const { notifySuccess, notifyError, notifyInfo } = useNotifications();

  const [activeTab, setActiveTab] = useState<ActiveEntityTab>('accounts');
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Account form state
  const [accountName, setAccountName] = useState('');
  const [accountType, setAccountType] = useState<AccountType>('bank');
  const [accountBalance, setAccountBalance] = useState('5000000');

  // Category form state
  const [categoryName, setCategoryName] = useState('');
  const [categoryKind, setCategoryKind] = useState<CategoryKind>('expense');

  // Transaction form state
  const [txAccountId, setTxAccountId] = useState('');
  const [txCategoryId, setTxCategoryId] = useState('');
  const [txType, setTxType] = useState<TransactionType>('expense');
  const [txAmount, setTxAmount] = useState('150000');
  const [txDescription, setTxDescription] = useState('');
  const [txDate, setTxDate] = useState(todayDateString());

  // Inline edit states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrimaryText, setEditPrimaryText] = useState('');
  const [editAmountText, setEditAmountText] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVerificationTestData();
      setAccounts(data.accounts);
      setCategories(data.categories);
      setTransactions(data.transactions);
      setTxAccountId((prev) =>
        data.accounts.some((a) => a.id === prev) ? prev : (data.accounts[0]?.id ?? '')
      );
      setTxCategoryId((prev) =>
        data.categories.some((c) => c.id === prev) ? prev : (data.categories[0]?.id ?? '')
      );
    } catch (error) {
      notifyError('Failed to load verification records', error);
    } finally {
      setLoading(false);
    }
  }, [notifyError]);

  useEffect(() => {
    let active = true;
    listVerificationTestData()
      .then((data) => {
        if (!active) return;
        setAccounts(data.accounts);
        setCategories(data.categories);
        setTransactions(data.transactions);
        setTxAccountId((prev) =>
          data.accounts.some((a) => a.id === prev) ? prev : (data.accounts[0]?.id ?? '')
        );
        setTxCategoryId((prev) =>
          data.categories.some((c) => c.id === prev) ? prev : (data.categories[0]?.id ?? '')
        );
      })
      .catch((error) => {
        if (!active) return;
        notifyError('Failed to load verification records', error);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notifyError]);

  const totalTestCount = accounts.length + categories.length + transactions.length;

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createTestAccount({
        name: accountName,
        type: accountType,
        initialBalance: Number(accountBalance) || 0,
      });
      setAccountName('');
      notifySuccess('Test account created', `${created.name} saved locally as Test Data.`);
      await loadData();
      setTxAccountId(created.id);
    } catch (error) {
      notifyError('Could not create test account', error);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createTestCategory({
        name: categoryName,
        kind: categoryKind,
      });
      setCategoryName('');
      notifySuccess('Test category created', `${created.name} saved locally as Test Data.`);
      await loadData();
      setTxCategoryId(created.id);
    } catch (error) {
      notifyError('Could not create test category', error);
    }
  };

  const handleCreateTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await createTestTransaction({
        accountId: txAccountId,
        categoryId: txCategoryId || undefined,
        type: txType,
        amount: Number(txAmount) || 0,
        description: txDescription,
        date: txDate,
      });
      setTxDescription('');
      notifySuccess('Test transaction created', `${created.description} persisted in IndexedDB.`);
      await loadData();
    } catch (error) {
      notifyError('Could not create test transaction', error);
    }
  };

  const startEdit = (id: string, primaryText: string, amount?: number) => {
    setEditingId(id);
    setEditPrimaryText(primaryText);
    setEditAmountText(amount !== undefined ? String(amount) : '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPrimaryText('');
    setEditAmountText('');
  };

  const handleSaveEdit = async (entity: ActiveEntityTab, id: string) => {
    try {
      if (entity === 'accounts') {
        await updateTestAccount(id, {
          name: editPrimaryText,
          initialBalance: Number(editAmountText) || 0,
        });
      } else if (entity === 'categories') {
        await updateTestCategory(id, editPrimaryText);
      } else {
        await updateTestTransaction(id, {
          description: editPrimaryText,
          amount: Number(editAmountText) || 0,
        });
      }
      cancelEdit();
      notifySuccess('Test record updated', 'Changes persisted to IndexedDB.');
      await loadData();
    } catch (error) {
      notifyError('Update failed', error);
    }
  };

  const handleDeleteSingle = async (entity: ActiveEntityTab, id: string, label: string) => {
    const approved = await confirm({
      title: 'Delete Test Record',
      description: `Remove verification test record "${label}" from IndexedDB?`,
      confirmLabel: 'Delete Test Record',
      tone: 'danger',
      details: [
        'Only this tagged Test Data record will be removed.',
        'Real user financial records are never affected by this action.',
      ],
    });
    if (!approved) return;

    try {
      if (entity === 'accounts') await deleteTestAccount(id);
      else if (entity === 'categories') await deleteTestCategory(id);
      else await deleteTestTransaction(id);
      notifySuccess('Test record deleted', `Removed "${label}".`);
      await loadData();
    } catch (error) {
      notifyError('Delete failed', error);
    }
  };

  const handleClearTestData = async () => {
    if (totalTestCount === 0) {
      notifyInfo('No test records found', 'There are currently 0 verification test records in IndexedDB.');
      return;
    }

    const approved = await confirm({
      title: 'Clear Verification Test Data',
      description:
        'This removes ONLY records created by the Stage 1 CRUD verification workbench (tagged isTestData = true).',
      confirmLabel: `Clear ${totalTestCount} Test Record(s)`,
      tone: 'danger',
      details: [
        `Test Accounts: ${accounts.length}`,
        `Test Categories: ${categories.length}`,
        `Test Transactions: ${transactions.length}`,
        'Real user financial records, preferences, and installation identity are strictly preserved.',
      ],
    });

    if (!approved) return;

    try {
      const summary = await clearAllVerificationTestData();
      notifySuccess(
        'Test data cleared',
        `Removed ${summary.totalDeleted} verification test record(s). User records were untouched.`
      );
      await loadData();
    } catch (error) {
      notifyError('Failed to clear test data', error);
    }
  };

  const accountNameById = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      {/* Safety Isolation Notice */}
      <section className="flex flex-col justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              Isolated CRUD Verification Workbench (Test Data Only)
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-700">
              Every record created here is explicitly tagged{' '}
              <code className="rounded bg-white px-1 py-0.5 font-mono text-[11px] text-slate-900">
                isTestData: true
              </code>{' '}
              and separated from real user financial data. Refresh the browser after creating or
              updating records to verify IndexedDB persistence.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void handleClearTestData()}
          disabled={totalTestCount === 0}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Clear Test Data ({totalTestCount})</span>
        </button>
      </section>

      {/* Segmented Entity Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {(
            [
              { id: 'accounts', label: `Test Accounts (${accounts.length})` },
              { id: 'categories', label: `Test Categories (${categories.length})` },
              { id: 'transactions', label: `Test Transactions (${transactions.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveTab(tab.id);
                cancelEdit();
              }}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entity Create Form + Table */}
      {activeTab === 'accounts' ? (
        <div className="space-y-6">
          <form
            onSubmit={(e) => void handleCreateAccount(e)}
            className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-4 sm:items-end"
          >
            <div className="sm:col-span-2">
              <label htmlFor="test-account-name" className="block text-xs font-medium text-slate-700">
                Test Account Name
              </label>
              <input
                id="test-account-name"
                type="text"
                required
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="e.g. BCA Checking Verification"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="test-account-type" className="block text-xs font-medium text-slate-700">
                Account Type
              </label>
              <select
                id="test-account-type"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as AccountType)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
                <option value="ewallet">E-Wallet</option>
                <option value="investment_cash">Platform Cash</option>
                <option value="investment_pool">Investment Pool</option>
              </select>
            </div>

            <div>
              <label htmlFor="test-account-balance" className="block text-xs font-medium text-slate-700">
                Initial Balance (IDR)
              </label>
              <div className="mt-1.5 flex gap-2">
                <input
                  id="test-account-balance"
                  type="number"
                  value={accountBalance}
                  onChange={(e) => setAccountBalance(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create</span>
                </button>
              </div>
            </div>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="px-4 py-2.5">Origin</th>
                  <th className="px-4 py-2.5">Account Name</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5 text-right">Initial Balance (IDR)</th>
                  <th className="px-4 py-2.5">Updated</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {accounts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      {loading
                        ? 'Loading test accounts...'
                        : 'No verification test accounts yet. Create one above to verify IndexedDB CRUD.'}
                    </td>
                  </tr>
                ) : (
                  accounts.map((acc) => {
                    const isEditing = editingId === acc.id;
                    return (
                      <tr key={acc.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <span className="inline-block whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-800">
                            Test Data
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editPrimaryText}
                              onChange={(e) => setEditPrimaryText(e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          ) : (
                            acc.name
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{acc.type}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-900 tabular-nums">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editAmountText}
                              onChange={(e) => setEditAmountText(e.target.value)}
                              className="w-32 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                            />
                          ) : (
                            formatCurrency(acc.initialBalance, acc.currency)
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums">
                          {formatTimestamp(acc.updatedAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEdit('accounts', acc.id)}
                                  aria-label="Save account edit"
                                  className="rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  aria-label="Cancel account edit"
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(acc.id, acc.name, acc.initialBalance)}
                                  aria-label={`Edit ${acc.name}`}
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteSingle('accounts', acc.id, acc.name)}
                                  aria-label={`Delete ${acc.name}`}
                                  className="rounded border border-red-200 bg-white p-1.5 text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'categories' ? (
        <div className="space-y-6">
          <form
            onSubmit={(e) => void handleCreateCategory(e)}
            className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-3 sm:items-end"
          >
            <div className="sm:col-span-2">
              <label htmlFor="test-cat-name" className="block text-xs font-medium text-slate-700">
                Test Category Name
              </label>
              <input
                id="test-cat-name"
                type="text"
                required
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="e.g. Groceries Test"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="test-cat-kind" className="block text-xs font-medium text-slate-700">
                Category Kind
              </label>
              <div className="mt-1.5 flex gap-2">
                <select
                  id="test-cat-kind"
                  value={categoryKind}
                  onChange={(e) => setCategoryKind(e.target.value as CategoryKind)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
                <button
                  type="submit"
                  className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create</span>
                </button>
              </div>
            </div>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="px-4 py-2.5">Origin</th>
                  <th className="px-4 py-2.5">Category Name</th>
                  <th className="px-4 py-2.5">Kind</th>
                  <th className="px-4 py-2.5">Updated</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-slate-500">
                      No verification test categories yet. Create one above.
                    </td>
                  </tr>
                ) : (
                  categories.map((cat) => {
                    const isEditing = editingId === cat.id;
                    return (
                      <tr key={cat.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <span className="inline-block whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-800">
                            Test Data
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editPrimaryText}
                              onChange={(e) => setEditPrimaryText(e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          ) : (
                            cat.name
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{cat.kind}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500 tabular-nums">
                          {formatTimestamp(cat.updatedAt)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEdit('categories', cat.id)}
                                  aria-label="Save category edit"
                                  className="rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  aria-label="Cancel category edit"
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(cat.id, cat.name)}
                                  aria-label={`Edit ${cat.name}`}
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteSingle('categories', cat.id, cat.name)}
                                  aria-label={`Delete ${cat.name}`}
                                  className="rounded border border-red-200 bg-white p-1.5 text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {activeTab === 'transactions' ? (
        <div className="space-y-6">
          <form
            onSubmit={(e) => void handleCreateTransaction(e)}
            className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-6 sm:items-end"
          >
            <div className="sm:col-span-2">
              <label htmlFor="test-tx-account" className="block text-xs font-medium text-slate-700">
                Test Account
              </label>
              <select
                id="test-tx-account"
                value={txAccountId}
                onChange={(e) => setTxAccountId(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                {accounts.length === 0 ? (
                  <option value="">Create a test account first</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label htmlFor="test-tx-category" className="block text-xs font-medium text-slate-700">
                Category (Optional)
              </label>
              <select
                id="test-tx-category"
                value={txCategoryId}
                onChange={(e) => setTxCategoryId(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="">Uncategorized</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="test-tx-type" className="block text-xs font-medium text-slate-700">
                Type
              </label>
              <select
                id="test-tx-type"
                value={txType}
                onChange={(e) => setTxType(e.target.value as TransactionType)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            </div>

            <div>
              <label htmlFor="test-tx-amount" className="block text-xs font-medium text-slate-700">
                Amount (IDR)
              </label>
              <input
                id="test-tx-amount"
                type="number"
                min={1}
                required
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="test-tx-date" className="block text-xs font-medium text-slate-700">
                Date
              </label>
              <input
                id="test-tx-date"
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-5">
              <label htmlFor="test-tx-desc" className="block text-xs font-medium text-slate-700">
                Description
              </label>
              <input
                id="test-tx-desc"
                type="text"
                required
                value={txDescription}
                onChange={(e) => setTxDescription(e.target.value)}
                placeholder="e.g. Sample coffee test entry"
                className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={accounts.length === 0}
                className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Entry</span>
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="px-4 py-2.5">Origin</th>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Description</th>
                  <th className="px-4 py-2.5">Account / Category</th>
                  <th className="px-4 py-2.5 text-right">Amount (IDR)</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-xs text-slate-500">
                      No verification test transactions yet. Create a test account first, then log
                      a test transaction above.
                    </td>
                  </tr>
                ) : (
                  transactions.map((tx) => {
                    const isEditing = editingId === tx.id;
                    return (
                      <tr key={tx.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-2.5">
                          <span className="inline-block whitespace-nowrap rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-amber-800">
                            Test Data
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 tabular-nums">
                          {tx.date}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-900">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editPrimaryText}
                              onChange={(e) => setEditPrimaryText(e.target.value)}
                              className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                            />
                          ) : (
                            tx.description
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          <span>{accountNameById.get(tx.accountId) ?? tx.accountId}</span>
                          {tx.categoryId ? (
                            <>
                              <span className="mx-1.5 text-slate-300" aria-hidden="true">
                                ·
                              </span>
                              <span>{categoryNameById.get(tx.categoryId) ?? tx.categoryId}</span>
                            </>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-900 tabular-nums">
                          {isEditing ? (
                            <input
                              type="number"
                              value={editAmountText}
                              onChange={(e) => setEditAmountText(e.target.value)}
                              className="w-32 rounded border border-slate-300 px-2 py-1 text-right font-mono text-xs"
                            />
                          ) : (
                            formatCurrency(tx.amount, tx.currency)
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleSaveEdit('transactions', tx.id)}
                                  aria-label="Save transaction edit"
                                  className="rounded border border-emerald-200 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelEdit}
                                  aria-label="Cancel transaction edit"
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => startEdit(tx.id, tx.description, tx.amount)}
                                  aria-label={`Edit ${tx.description}`}
                                  className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDeleteSingle('transactions', tx.id, tx.description)
                                  }
                                  aria-label={`Delete ${tx.description}`}
                                  className="rounded border border-red-200 bg-white p-1.5 text-red-600 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
