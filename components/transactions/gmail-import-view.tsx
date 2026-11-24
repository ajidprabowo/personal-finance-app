'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Clock,
  FileSearch,
  Mail,
  RefreshCw,
  Settings,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/app-layout';
import { PageContainer } from '@/components/layout/page-container';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Select } from '@/components/ui/select';
import { useBootstrap } from '@/hooks/use-bootstrap';
import { useNotifications } from '@/hooks/use-notifications';
import { APP_CONFIG } from '@/lib/config';
import { formatCurrency } from '@/lib/currency';
import { formatDisplayDate, formatTimestamp, todayDateString } from '@/lib/dates';
import { normalizeErrorMessage } from '@/lib/errors';
import { cn } from '@/lib/utils';
import {
  connectGmailAccount,
  getGmailSessionSnapshot,
  type GmailSessionSnapshot,
} from '@/services/gmail-connection.service';
import {
  approveImportedCandidate,
  getDefaultGmailSyncFilters,
  listGmailImportHistory,
  rejectImportedCandidate,
  syncGmailTransactions,
} from '@/services/gmail-import.service';
import {
  listUserAccounts,
  listUserCategoriesWithCounts,
  listUserSubcategories,
} from '@/services/settings.service';
import type {
  Account,
  Category,
  EmailImportHistory,
  Subcategory,
  TransactionType,
} from '@/types/entities';
import type {
  EmailCandidateClassification,
  EvaluatedEmailCandidate,
  GmailSyncMetrics,
} from '@/types/gmail-import';

type ReviewTab = 'pending' | 'ready' | 'needs_review' | 'all' | 'history';

const CLASSIFICATION_LABEL: Record<EmailCandidateClassification, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  refund: 'Refund',
  investment: 'Investment Activity',
  unknown: 'Unknown',
};

const CLASSIFICATION_STYLE: Record<EmailCandidateClassification, string> = {
  income: 'border-status-success/30 bg-status-success/10 text-status-success',
  expense: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
  transfer: 'border-brand-secondary/30 bg-brand-secondary/10 text-brand-secondary',
  refund: 'border-status-success/30 bg-status-success/10 text-status-success',
  investment: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  unknown: 'border-line bg-surface-muted text-ink-muted',
};

function defaultTransactionTypeForCandidate(
  candidate: EvaluatedEmailCandidate
): TransactionType {
  if (candidate.classification === 'income' || candidate.classification === 'refund') {
    return 'income';
  }
  if (candidate.classification === 'transfer') {
    return 'transfer';
  }
  return 'expense';
}

interface ReviewModalState {
  candidate: EvaluatedEmailCandidate;
  type: TransactionType;
  date: string;
  amount: string;
  description: string;
  accountId: string;
  toAccountId: string;
  categoryId: string;
  subcategoryId: string;
  notes: string;
  error: string | null;
  submitting: boolean;
}

export function GmailImportView() {
  const { preferences } = useBootstrap();
  const { notifySuccess, notifyError, notifyWarning } = useNotifications();

  const timezone = preferences?.timezone ?? APP_CONFIG.defaultTimezone;
  const numberFormat = preferences?.numberFormat ?? APP_CONFIG.defaultNumberFormat;
  const dateFormat = preferences?.dateFormat ?? APP_CONFIG.defaultDateFormat;

  const [session, setSession] = useState<GmailSessionSnapshot | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [history, setHistory] = useState<EmailImportHistory[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  const [dateFrom, setDateFrom] = useState<string>(
    () => getDefaultGmailSyncFilters(timezone).dateFrom
  );
  const [dateTo, setDateTo] = useState<string>(
    () => getDefaultGmailSyncFilters(timezone).dateTo
  );
  const [senderFilter, setSenderFilter] = useState<string>('');
  const [subjectFilter, setSubjectFilter] = useState<string>('');
  const [keywordsFilter, setKeywordsFilter] = useState<string>('');

  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [candidates, setCandidates] = useState<EvaluatedEmailCandidate[]>([]);
  const [metrics, setMetrics] = useState<GmailSyncMetrics | null>(null);
  const [activeTab, setActiveTab] = useState<ReviewTab>('pending');
  const [reviewModal, setReviewModal] = useState<ReviewModalState | null>(null);
  const [modalSubcategories, setModalSubcategories] = useState<Subcategory[]>([]);

  const loadLocalContext = useCallback(async () => {
    const [sessionSnap, accountRows, catData, subRows, historyRows] = await Promise.all([
      getGmailSessionSnapshot(),
      listUserAccounts(),
      listUserCategoriesWithCounts(),
      listUserSubcategories(),
      listGmailImportHistory(100),
    ]);
    setSession(sessionSnap);
    setAccounts(accountRows);
    setCategories(catData.categories);
    setSubcategories(subRows);
    setHistory(historyRows);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const oauthResult = url.searchParams.get('gmail');
      if (oauthResult === 'connected') {
        if (sessionSnap.effectiveStatus === 'connected') {
          notifySuccess(
            'Gmail connected',
            `Verified read-only access for ${sessionSnap.connection?.emailAddress ?? 'Gmail'}.`
          );
        } else {
          notifyError(
            'Gmail verification failed',
            'Google returned to the app, but the server could not verify the Gmail session.'
          );
        }
        url.searchParams.delete('gmail');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      } else if (oauthResult === 'error') {
        notifyError(
          'Gmail connection failed',
          'Google authorization did not complete. Check the deployment logs for the Gmail OAuth callback failure stage.'
        );
        url.searchParams.delete('gmail');
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
      }
    }
  }, [notifyError, notifySuccess]);

  useEffect(() => {
    let active = true;
    loadLocalContext()
      .catch((err) => {
        if (active) notifyError('Failed to load import context', err);
      })
      .finally(() => {
        if (active) setLoadingInitial(false);
      });
    return () => {
      active = false;
    };
  }, [loadLocalContext, notifyError]);

  const activeAccounts = useMemo(
    () => accounts.filter((acc) => !acc.isArchived),
    [accounts]
  );

  const activeCategories = useMemo(
    () => categories.filter((cat) => !cat.isArchived),
    [categories]
  );

  const handleConnectGmail = async () => {
    setConnecting(true);
    try {
      await connectGmailAccount();
    } catch (error) {
      notifyError('Gmail connection failed', error);
    } finally {
      setConnecting(false);
    }
  };

  const handleSync = async (pageToken?: string) => {
    setSyncing(true);
    try {
      const result = await syncGmailTransactions({
        filters: {
          dateFrom,
          dateTo,
          sender: senderFilter.trim() || undefined,
          subjectKeyword: subjectFilter.trim() || undefined,
          keywords: keywordsFilter.trim() || undefined,
          maxResults: 25,
          pageToken,
        },
        recordOrigin: 'user',
      });

      setCandidates((prev) => {
        if (!pageToken) return result.candidates;
        const seen = new Set(prev.map((c) => c.externalMessageId));
        const merged = [...prev];
        for (const item of result.candidates) {
          if (!seen.has(item.externalMessageId)) {
            merged.push(item);
          }
        }
        return merged;
      });
      setMetrics(result.metrics);
      await loadLocalContext();

      notifySuccess(
        'Gmail sync complete',
        `Discovered ${result.metrics.discoveredCount} email(s), extracted ${result.metrics.extractedCount} candidate(s).`
      );
    } catch (error) {
      await loadLocalContext().catch(() => undefined);
      notifyError('Gmail sync failed', error);
    } finally {
      setSyncing(false);
    }
  };

  const openReviewModal = (candidate: EvaluatedEmailCandidate) => {
    const defaultType = defaultTransactionTypeForCandidate(candidate);
    const matchingCurrencyAccount =
      activeAccounts.find((a) => !candidate.currency || a.currency === candidate.currency) ??
      activeAccounts[0];
    const matchingDestAccount = activeAccounts.find(
      (a) =>
        a.id !== matchingCurrencyAccount?.id &&
        a.currency === matchingCurrencyAccount?.currency
    );

    const matchingCategory =
      activeCategories.find((c) => c.kind === (defaultType === 'income' ? 'income' : 'expense')) ??
      activeCategories[0];

    const categoryId = defaultType === 'transfer' ? '' : matchingCategory?.id ?? '';
    setModalSubcategories(
      subcategories.filter((s) => !s.isArchived && s.categoryId === categoryId)
    );

    setReviewModal({
      candidate,
      type: defaultType,
      date: candidate.date ?? todayDateString(timezone),
      amount: candidate.amount !== null ? String(candidate.amount) : '',
      description: candidate.description,
      accountId: matchingCurrencyAccount?.id ?? '',
      toAccountId: matchingDestAccount?.id ?? '',
      categoryId,
      subcategoryId: '',
      notes: candidate.notesSummary,
      error: null,
      submitting: false,
    });
  };

  const handleModalTypeChange = (nextType: TransactionType) => {
    setReviewModal((prev) => {
      if (!prev) return null;
      if (nextType === 'transfer') {
        const source = activeAccounts.find((a) => a.id === prev.accountId) ?? activeAccounts[0];
        const dest = activeAccounts.find(
          (a) => a.id !== source?.id && a.currency === source?.currency
        );
        return {
          ...prev,
          type: nextType,
          categoryId: '',
          subcategoryId: '',
          toAccountId: dest?.id ?? '',
          error: null,
        };
      }
      const nextCats = activeCategories.filter((c) => c.kind === nextType);
      const nextCatId = nextCats[0]?.id ?? '';
      setModalSubcategories(
        subcategories.filter((s) => !s.isArchived && s.categoryId === nextCatId)
      );
      return {
        ...prev,
        type: nextType,
        categoryId: nextCatId,
        subcategoryId: '',
        toAccountId: '',
        error: null,
      };
    });
  };

  const handleModalCategoryChange = (nextCategoryId: string) => {
    setModalSubcategories(
      subcategories.filter((s) => !s.isArchived && s.categoryId === nextCategoryId)
    );
    setReviewModal((prev) =>
      prev ? { ...prev, categoryId: nextCategoryId, subcategoryId: '', error: null } : null
    );
  };

  const handleApproveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewModal) return;

    const numericAmount = Number(reviewModal.amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setReviewModal((prev) =>
        prev ? { ...prev, error: 'Please enter a valid positive amount.' } : null
      );
      return;
    }

    setReviewModal((prev) => (prev ? { ...prev, submitting: true, error: null } : null));
    try {
      const hasExactDuplicate = reviewModal.candidate.duplicateWarnings.some(
        (w) => w.kind === 'exact_message_imported'
      );
      const result = await approveImportedCandidate(
        reviewModal.candidate,
        {
          type: reviewModal.type,
          amount: numericAmount,
          date: reviewModal.date,
          accountId: reviewModal.accountId,
          toAccountId: reviewModal.type === 'transfer' ? reviewModal.toAccountId : undefined,
          categoryId: reviewModal.type === 'transfer' ? undefined : reviewModal.categoryId,
          subcategoryId:
            reviewModal.type === 'transfer'
              ? undefined
              : reviewModal.subcategoryId || undefined,
          description: reviewModal.description,
          notes: reviewModal.notes,
        },
        {
          recordOrigin: 'user',
          allowDuplicateOverride: hasExactDuplicate,
        }
      );

      setCandidates((prev) =>
        prev.map((c) =>
          c.externalMessageId === reviewModal.candidate.externalMessageId
            ? {
                ...c,
                historyStatus: 'imported',
                matchedTransactionId: result.transaction.id,
                matchedHistoryId: result.history.id,
                alreadyProcessed: true,
              }
            : c
        )
      );
      await loadLocalContext();
      setReviewModal(null);
      notifySuccess(
        'Transaction imported',
        `Added "${result.transaction.description}" to your local ledger.`
      );
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setReviewModal((prev) =>
        prev ? { ...prev, submitting: false, error: message } : null
      );
    }
  };

  const handleReject = async (
    candidate: EvaluatedEmailCandidate,
    status: 'skipped' | 'duplicate'
  ) => {
    try {
      const row = await rejectImportedCandidate(candidate, status);
      setCandidates((prev) =>
        prev.map((c) =>
          c.externalMessageId === candidate.externalMessageId
            ? {
                ...c,
                historyStatus: status,
                matchedHistoryId: row.id,
                alreadyProcessed: true,
              }
            : c
        )
      );
      await loadLocalContext();
      notifyWarning(
        status === 'duplicate' ? 'Marked as duplicate' : 'Candidate ignored',
        `"${candidate.subjectSummary}" recorded in local import history.`
      );
    } catch (error) {
      notifyError('Failed to update candidate status', error);
    }
  };

  const filteredCandidates = useMemo(() => {
    if (activeTab === 'pending') {
      return candidates.filter((c) => !c.alreadyProcessed);
    }
    if (activeTab === 'ready') {
      return candidates.filter((c) => !c.alreadyProcessed && c.extractionStatus === 'ready');
    }
    if (activeTab === 'needs_review') {
      return candidates.filter((c) => !c.alreadyProcessed && c.extractionStatus !== 'ready');
    }
    return candidates;
  }, [candidates, activeTab]);

  const effectiveStatus = session?.effectiveStatus ?? 'disconnected';
  const isConnected = effectiveStatus === 'connected';
  const isExpired = effectiveStatus === 'token_expired';

  const selectedSourceAccount = useMemo(
    () => activeAccounts.find((a) => a.id === reviewModal?.accountId),
    [activeAccounts, reviewModal?.accountId]
  );

  const modalCurrencyMismatch = Boolean(
    reviewModal &&
      reviewModal.candidate.currency &&
      selectedSourceAccount &&
      reviewModal.candidate.currency !== selectedSourceAccount.currency
  );

  const modalCategoriesForType = useMemo(() => {
    if (!reviewModal || reviewModal.type === 'transfer') return [];
    return activeCategories.filter((c) => c.kind === reviewModal.type);
  }, [activeCategories, reviewModal]);

  const isInvestmentBlockedAsExpense = Boolean(
    reviewModal &&
      reviewModal.candidate.classification === 'investment' &&
      reviewModal.type === 'expense'
  );

  return (
    <AppLayout>
      <PageContainer>
        <PageHeader
          title="Import Transactions from Gmail"
          description="Discover transaction notifications from your Gmail inbox, review extracted fields, check duplicates, and approve imports into your local ledger."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/transactions">
                <Button variant="outline" size="sm">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to Ledger</span>
                </Button>
              </Link>
              <Link href="/profile?section=email">
                <Button variant="ghost" size="sm">
                  <Settings className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Email Settings</span>
                </Button>
              </Link>
            </div>
          }
        />

        <div className="space-y-6">
          {/* Connection & Privacy Banner */}
          <Card padding="md">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink">
                    Gmail Read-Only Connection
                  </h2>
                  <span
                    className={cn(
                      'rounded border px-2 py-0.5 text-xs font-medium',
                      isConnected
                        ? 'border-status-success/30 bg-status-success/10 text-status-success'
                        : isExpired
                          ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                          : 'border-line bg-surface-muted text-ink-muted'
                    )}
                  >
                    {loadingInitial
                      ? 'Checking...'
                      : isConnected
                        ? `Connected: ${session?.connection?.emailAddress ?? 'Gmail'}`
                        : isExpired
                          ? `Session Expired (${session?.connection?.emailAddress ?? 'Reconnect'})`
                          : 'Disconnected'}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">
                  <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-brand-secondary" aria-hidden="true" />
                  Minimum scope <code className="font-mono">gmail.readonly</code>. Only reviewed &amp; approved transactions are written to your local IndexedDB ledger; full email bodies are never stored.
                </p>
                {session?.connection?.lastSyncedAt ? (
                  <p className="font-mono text-[11px] tabular-nums text-ink-muted">
                    Last successful sync: {formatTimestamp(session.connection.lastSyncedAt, timezone)}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!isConnected ? (
                  <Button
                    size="sm"
                    loading={connecting}
                    onClick={() => void handleConnectGmail()}
                  >
                    {isExpired ? (
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{isExpired ? 'Reconnect Gmail' : 'Connect Gmail'}</span>
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={connecting}
                    onClick={() => void handleConnectGmail()}
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Switch Account</span>
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {/* Manual Sync Filter Controls */}
          <Card padding="md">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">Manual Inbox Sync</h2>
                <p className="text-xs text-ink-muted">
                  Defaults to the last 30 days. Refine by sender, subject, or keywords before scanning.
                </p>
              </div>
              <Button
                size="sm"
                loading={syncing}
                disabled={!isConnected || activeAccounts.length === 0}
                onClick={() => void handleSync()}
              >
                <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{syncing ? 'Scanning Inbox...' : 'Sync Gmail'}</span>
              </Button>
            </div>

            {activeAccounts.length === 0 && !loadingInitial ? (
              <div className="mb-4 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning">
                Create at least one active local account in{' '}
                <Link href="/profile?section=accounts" className="font-semibold underline">
                  Accounts Management
                </Link>{' '}
                before importing transactions.
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Input
                label="From Date"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input
                label="To Date"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
              <Input
                label="Sender Filter"
                placeholder="e.g. bca.co.id"
                value={senderFilter}
                onChange={(e) => setSenderFilter(e.target.value)}
              />
              <Input
                label="Subject Keyword"
                placeholder="e.g. Transaction Alert"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
              />
              <Input
                label="Keywords (Optional)"
                placeholder="Default: transaction terms"
                value={keywordsFilter}
                onChange={(e) => setKeywordsFilter(e.target.value)}
              />
            </div>

            {metrics ? (
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 sm:grid-cols-5">
                <div className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2">
                  <p className="text-[11px] text-ink-muted">Discovered</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {metrics.discoveredCount}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2">
                  <p className="text-[11px] text-ink-muted">Extracted</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {metrics.extractedCount}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2">
                  <p className="text-[11px] text-ink-muted">Needs Review</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-status-warning">
                    {metrics.needsReviewCount}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2">
                  <p className="text-[11px] text-ink-muted">Duplicate Alerts</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-ink">
                    {metrics.duplicateWarningCount}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-surface-muted/50 px-3 py-2">
                  <p className="text-[11px] text-ink-muted">Failed Parses</p>
                  <p className="font-mono text-sm font-semibold tabular-nums text-status-danger">
                    {metrics.failedCount}
                  </p>
                </div>
              </div>
            ) : null}
          </Card>

          {/* Tabs: Candidates vs Import History */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'pending', label: `Pending Review (${candidates.filter((c) => !c.alreadyProcessed).length})` },
                  { id: 'ready', label: 'Ready' },
                  { id: 'needs_review', label: 'Needs Review' },
                  { id: 'all', label: `All Fetched (${candidates.length})` },
                  { id: 'history', label: `Import History (${history.length})` },
                ] as Array<{ id: ReviewTab; label: string }>
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'border-brand-primary bg-brand-primary text-brand-primary-foreground'
                      : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {metrics?.nextPageToken ? (
              <Button
                variant="outline"
                size="sm"
                loading={syncing}
                onClick={() => void handleSync(metrics.nextPageToken)}
              >
                <span>Load Next Page</span>
              </Button>
            ) : null}
          </div>

          {/* Candidate Review List OR Import History */}
          {activeTab === 'history' ? (
            history.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-5 w-5" aria-hidden="true" />}
                title="No email import history yet"
                description="Once you approve, ignore, or mark Gmail candidates as duplicates, minimal audit metadata appears here."
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted/70 font-semibold text-ink-muted">
                        <th className="px-4 py-3">Subject Summary</th>
                        <th className="px-4 py-3">Received</th>
                        <th className="px-4 py-3">Processed</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Details / Ledger Link</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {history.map((row) => (
                        <tr key={row.id} className="hover:bg-surface-muted/40">
                          <td className="max-w-xs px-4 py-3">
                            <p className="truncate font-medium text-ink">
                              {row.subjectSummary || '(No Subject)'}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                              Msg: {row.externalMessageId}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums text-ink-muted">
                            {formatTimestamp(row.receivedAt, timezone)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-mono tabular-nums text-ink-muted">
                            {formatTimestamp(row.processedAt, timezone)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <span
                              className={cn(
                                'inline-flex rounded border px-2 py-0.5 font-medium capitalize',
                                row.status === 'imported'
                                  ? 'border-status-success/30 bg-status-success/10 text-status-success'
                                  : row.status === 'failed'
                                    ? 'border-status-danger/30 bg-status-danger/10 text-status-danger'
                                    : row.status === 'duplicate'
                                      ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                                      : 'border-line bg-surface-muted text-ink-muted'
                              )}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="max-w-xs px-4 py-3 text-ink-muted">
                            {row.matchedTransactionId ? (
                              <span className="font-mono text-[11px]">
                                Tx: {row.matchedTransactionId.slice(0, 12)}…
                              </span>
                            ) : row.errorMessage ? (
                              <span className="text-status-danger">{row.errorMessage}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          ) : filteredCandidates.length === 0 ? (
            <EmptyState
              icon={<Mail className="h-5 w-5" aria-hidden="true" />}
              title={
                candidates.length === 0
                  ? 'Ready to scan Gmail for transactions'
                  : 'No candidates in this filter view'
              }
              description={
                candidates.length === 0
                  ? isConnected
                    ? 'Select a date range and click "Sync Gmail" to extract transaction candidates for review.'
                    : 'Connect your Gmail account with read-only permissions, then run a manual sync to inspect transaction emails.'
                  : 'Switch tabs or sync another date range to review more email candidates.'
              }
              action={
                !isConnected ? (
                  <Button size="sm" loading={connecting} onClick={() => void handleConnectGmail()}>
                    <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{isExpired ? 'Reconnect Gmail' : 'Connect Gmail'}</span>
                  </Button>
                ) : candidates.length === 0 ? (
                  <Button
                    size="sm"
                    loading={syncing}
                    disabled={activeAccounts.length === 0}
                    onClick={() => void handleSync()}
                  >
                    <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Sync Gmail</span>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-3">
              {filteredCandidates.map((candidate) => (
                <Card key={candidate.externalMessageId} padding="md">
                  <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold',
                            CLASSIFICATION_STYLE[candidate.classification]
                          )}
                        >
                          {CLASSIFICATION_LABEL[candidate.classification]}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium',
                            candidate.extractionStatus === 'ready'
                              ? 'border-status-success/30 bg-status-success/10 text-status-success'
                              : candidate.extractionStatus === 'needs_review'
                                ? 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                                : 'border-status-danger/30 bg-status-danger/10 text-status-danger'
                          )}
                        >
                          {candidate.extractionStatus === 'ready'
                            ? 'Ready for Review'
                            : candidate.extractionStatus === 'needs_review'
                              ? 'Needs Review'
                              : 'Ambiguous / Incomplete'}
                        </span>
                        {candidate.historyStatus ? (
                          <span className="inline-flex items-center gap-1 rounded border border-line bg-surface-muted px-2 py-0.5 text-[11px] font-medium capitalize text-ink">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            <span>{candidate.historyStatus}</span>
                          </span>
                        ) : null}
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-ink">
                          {candidate.description}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          Subject: {candidate.subjectSummary}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                        <span className="tabular-nums">
                          Date:{' '}
                          <strong className="font-medium text-ink">
                            {candidate.date
                              ? formatDisplayDate(candidate.date, dateFormat)
                              : 'Missing (Review Required)'}
                          </strong>
                        </span>
                        <span>
                          Sender/Bank:{' '}
                          <strong className="font-medium text-ink">
                            {candidate.institution || candidate.fromSummary}
                          </strong>
                        </span>
                        {candidate.referenceNumber ? (
                          <span className="font-mono">
                            Ref: {candidate.referenceNumber}
                          </span>
                        ) : null}
                      </div>

                      {candidate.classification === 'investment' ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
                          <span className="flex items-center gap-1.5">
                            <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Investment-related notice detected. Must not import as an ordinary expense; record in Investments or ignore.
                          </span>
                          <Link href="/investments" className="inline-flex items-center gap-1 font-semibold underline">
                            <span>Open Investments</span>
                            <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                          </Link>
                        </div>
                      ) : null}

                      {candidate.duplicateWarnings.length > 0 ? (
                        <div className="space-y-1">
                          {candidate.duplicateWarnings.map((warn, idx) => (
                            <div
                              key={idx}
                              className={cn(
                                'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
                                warn.severity === 'blocking'
                                  ? 'border-status-danger/30 bg-status-danger/10 text-status-danger'
                                  : 'border-status-warning/30 bg-status-warning/10 text-status-warning'
                              )}
                            >
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span>{warn.message}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
                      <div className="text-left lg:text-right">
                        <p className="text-base font-semibold tabular-nums text-ink">
                          {candidate.amount !== null && candidate.currency
                            ? formatCurrency(candidate.amount, candidate.currency, numberFormat)
                            : 'Amount Missing'}
                        </p>
                        <p className="font-mono text-[11px] text-ink-muted">
                          {candidate.currency ?? 'Currency Unclear'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant={candidate.alreadyProcessed ? 'outline' : 'primary'}
                          disabled={activeAccounts.length === 0 || candidate.historyStatus === 'imported'}
                          onClick={() => openReviewModal(candidate)}
                        >
                          <span>
                            {candidate.historyStatus === 'imported'
                              ? 'Imported'
                              : 'Review & Import'}
                          </span>
                        </Button>
                        {!candidate.alreadyProcessed ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void handleReject(candidate, 'duplicate')}
                            >
                              <span>Duplicate</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleReject(candidate, 'skipped')}
                            >
                              <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Ignore</span>
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </PageContainer>

      {/* Candidate Review & Approval Modal */}
      <Modal
        open={Boolean(reviewModal)}
        onClose={() => {
          if (!reviewModal?.submitting) {
            setReviewModal(null);
          }
        }}
        title="Review & Approve Transaction Import"
        description="Verify or edit the extracted fields and select the local account before posting to your ledger."
      >
        {reviewModal ? (
          <form onSubmit={(e) => void handleApproveSubmit(e)} className="space-y-4">
            {reviewModal.candidate.duplicateWarnings.length > 0 ? (
              <div className="space-y-1.5">
                {reviewModal.candidate.duplicateWarnings.map((warn, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-2.5 text-xs text-status-warning"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{warn.message}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {reviewModal.candidate.classification === 'investment' ? (
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning">
                <p className="font-semibold">Investment Activity Guidance</p>
                <p className="mt-1">
                  Investment purchases and dividends cannot be imported as ordinary expenses. Record holdings/activities directly in{' '}
                  <Link href="/investments" className="font-semibold underline">
                    Investments
                  </Link>{' '}
                  or choose Transfer if this email represents a cash funding transfer into a platform cash account.
                </p>
              </div>
            ) : null}

            {reviewModal.candidate.classification === 'refund' ? (
              <div className="rounded-lg border border-brand-secondary/30 bg-brand-secondary/10 p-3 text-xs text-brand-secondary">
                Refund detected. Verify whether to import this refund as Income into the receiving account.
              </div>
            ) : null}

            {modalCurrencyMismatch ? (
              <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-2.5 text-xs text-status-warning">
                Email currency ({reviewModal.candidate.currency}) differs from selected account currency ({selectedSourceAccount?.currency}). Verify the account or adjusted amount before approving.
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Transaction Type"
                value={reviewModal.type}
                onChange={(e) => handleModalTypeChange(e.target.value as TransactionType)}
                options={[
                  { value: 'expense', label: 'Expense' },
                  { value: 'income', label: 'Income' },
                  { value: 'transfer', label: 'Internal Transfer' },
                ]}
              />
              <Input
                label="Date"
                type="date"
                required
                value={reviewModal.date}
                onChange={(e) =>
                  setReviewModal((prev) => (prev ? { ...prev, date: e.target.value } : null))
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={`Amount (${selectedSourceAccount?.currency ?? reviewModal.candidate.currency ?? 'IDR'})`}
                type="number"
                step="any"
                min="0"
                required
                value={reviewModal.amount}
                onChange={(e) =>
                  setReviewModal((prev) => (prev ? { ...prev, amount: e.target.value } : null))
                }
              />
              <Input
                label="Description"
                required
                value={reviewModal.description}
                onChange={(e) =>
                  setReviewModal((prev) =>
                    prev ? { ...prev, description: e.target.value } : null
                  )
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={reviewModal.type === 'transfer' ? 'From Account' : 'Account'}
                value={reviewModal.accountId}
                onChange={(e) =>
                  setReviewModal((prev) =>
                    prev ? { ...prev, accountId: e.target.value } : null
                  )
                }
                options={activeAccounts.map((acc) => ({
                  value: acc.id,
                  label: `${acc.name} (${acc.currency})`,
                }))}
              />

              {reviewModal.type === 'transfer' ? (
                <Select
                  label="To Account"
                  value={reviewModal.toAccountId}
                  onChange={(e) =>
                    setReviewModal((prev) =>
                      prev ? { ...prev, toAccountId: e.target.value } : null
                    )
                  }
                  options={activeAccounts
                    .filter(
                      (acc) =>
                        acc.id !== reviewModal.accountId &&
                        (!selectedSourceAccount || acc.currency === selectedSourceAccount.currency)
                    )
                    .map((acc) => ({
                      value: acc.id,
                      label: `${acc.name} (${acc.currency})`,
                    }))}
                />
              ) : (
                <Select
                  label="Category"
                  value={reviewModal.categoryId}
                  onChange={(e) => handleModalCategoryChange(e.target.value)}
                  options={modalCategoriesForType.map((c) => ({
                    value: c.id,
                    label: c.name,
                  }))}
                />
              )}
            </div>

            {reviewModal.type !== 'transfer' && modalSubcategories.length > 0 ? (
              <Select
                label="Subcategory (Optional)"
                value={reviewModal.subcategoryId}
                onChange={(e) =>
                  setReviewModal((prev) =>
                    prev ? { ...prev, subcategoryId: e.target.value } : null
                  )
                }
                options={[
                  { value: '', label: 'None' },
                  ...modalSubcategories.map((s) => ({
                    value: s.id,
                    label: s.name,
                  })),
                ]}
              />
            ) : null}

            <Input
              label="Notes"
              value={reviewModal.notes}
              onChange={(e) =>
                setReviewModal((prev) => (prev ? { ...prev, notes: e.target.value } : null))
              }
            />

            {reviewModal.error ? (
              <div className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-2.5 text-xs text-status-danger">
                {reviewModal.error}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={reviewModal.submitting}
                onClick={() => setReviewModal(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                loading={reviewModal.submitting}
                disabled={isInvestmentBlockedAsExpense}
              >
                Approve &amp; Import
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </AppLayout>
  );
}
