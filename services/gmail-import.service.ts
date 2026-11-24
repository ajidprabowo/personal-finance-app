import { roundCurrencyAmount } from '@/lib/currency';
import {
  calendarDayDiff,
  getTodayInTimezone,
  isValidDateString,
  nowIso,
  shiftCalendarDays,
} from '@/lib/dates';
import { ValidationError } from '@/lib/errors';
import {
  accountsRepository,
  appInstallationRepository,
  emailImportHistoryRepository,
  transactionsRepository,
} from '@/repositories';
import {
  getCurrentGmailConnection,
  markGmailTokenExpired,
  recordGmailSyncMetadata,
} from '@/services/gmail-connection.service';
import { createTransaction } from '@/services/transaction.service';
import type {
  Account,
  EmailImportHistory,
  EmailImportStatus,
  RecordOrigin,
  Transaction,
} from '@/types/entities';
import type {
  ApproveEmailImportInput,
  DuplicateWarning,
  EvaluatedEmailCandidate,
  GmailSyncFilters,
  GmailSyncResult,
  ParsedEmailTransactionCandidate,
} from '@/types/gmail-import';

export function getDefaultGmailSyncFilters(timezone?: string): GmailSyncFilters {
  const today = getTodayInTimezone(timezone);
  const thirtyDaysAgo = shiftCalendarDays(today, -30);
  return {
    dateFrom: thirtyDaysAgo,
    dateTo: today,
    maxResults: 25,
  };
}

function normalizeTokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((tok) => tok.length >= 3)
  );
}

function sharesDescriptiveTokens(a: string, b: string): boolean {
  const setA = normalizeTokenSet(a);
  const setB = normalizeTokenSet(b);
  for (const token of setA) {
    if (setB.has(token)) return true;
  }
  return false;
}

export function evaluateCandidateDuplicates(
  candidate: ParsedEmailTransactionCandidate,
  existingTransactions: Transaction[],
  existingHistory: EmailImportHistory[],
  accountsById: Map<string, Account>
): EvaluatedEmailCandidate {
  const duplicateWarnings: DuplicateWarning[] = [];
  let historyMatch: EmailImportHistory | undefined;

  // 1. Primary email deduplication by Gmail externalMessageId
  for (const row of existingHistory) {
    if (row.externalMessageId === candidate.externalMessageId) {
      if (!historyMatch || row.processedAt > historyMatch.processedAt) {
        historyMatch = row;
      }
    }
  }

  if (historyMatch) {
    if (historyMatch.status === 'imported') {
      duplicateWarnings.push({
        kind: 'exact_message_imported',
        severity: 'blocking',
        message: 'This Gmail message was already imported into your ledger.',
        matchedTransactionId: historyMatch.matchedTransactionId,
        matchedHistoryId: historyMatch.id,
      });
    } else if (historyMatch.status === 'skipped') {
      duplicateWarnings.push({
        kind: 'exact_message_skipped',
        severity: 'info',
        message: 'You previously rejected or ignored this Gmail message.',
        matchedHistoryId: historyMatch.id,
      });
    } else if (historyMatch.status === 'duplicate') {
      duplicateWarnings.push({
        kind: 'exact_message_duplicate',
        severity: 'warning',
        message: 'This Gmail message was previously marked as a duplicate.',
        matchedTransactionId: historyMatch.matchedTransactionId,
        matchedHistoryId: historyMatch.id,
      });
    } else if (historyMatch.status === 'failed') {
      duplicateWarnings.push({
        kind: 'previous_failed',
        severity: 'warning',
        message: historyMatch.errorMessage
          ? `Previous import attempt failed: ${historyMatch.errorMessage}`
          : 'A previous import attempt for this email failed.',
        matchedHistoryId: historyMatch.id,
      });
    }
  }

  // Also check directly on transactions.emailImportId in case history was pruned or restored
  const directEmailLinkedTx = existingTransactions.find(
    (tx) => tx.emailImportId === candidate.externalMessageId
  );
  if (
    directEmailLinkedTx &&
    !duplicateWarnings.some((w) => w.kind === 'exact_message_imported')
  ) {
    duplicateWarnings.push({
      kind: 'exact_message_imported',
      severity: 'blocking',
      message: 'A ledger transaction already references this Gmail Message ID.',
      matchedTransactionId: directEmailLinkedTx.id,
    });
  }

  // 2. Secondary financial duplicate heuristics (non-destructive warnings)
  const refLower = candidate.referenceNumber?.toLowerCase();
  if (refLower) {
    const refMatchTx = existingTransactions.find((tx) => {
      const haystack = `${tx.notes ?? ''} ${tx.description}`.toLowerCase();
      return haystack.includes(refLower);
    });
    if (refMatchTx) {
      duplicateWarnings.push({
        kind: 'reference_match',
        severity: 'warning',
        message: `Reference number ${candidate.referenceNumber} matches existing transaction "${refMatchTx.description}" (${refMatchTx.date}).`,
        matchedTransactionId: refMatchTx.id,
      });
    }
  }

  if (
    candidate.amount !== null &&
    candidate.currency &&
    candidate.date &&
    isValidDateString(candidate.date)
  ) {
    const normalizedCandidateAmount = roundCurrencyAmount(
      candidate.amount,
      candidate.currency
    );

    const similarTx = existingTransactions.find((tx) => {
      if (tx.emailImportId === candidate.externalMessageId) return false;
      if (tx.currency !== candidate.currency) return false;
      const txAmount = roundCurrencyAmount(tx.amount, tx.currency);
      if (txAmount !== normalizedCandidateAmount) return false;
      const dayDelta = Math.abs(calendarDayDiff(tx.date, candidate.date!));
      if (dayDelta > 1) return false;

      // Require compatible direction/type or matching merchant/card context
      if (candidate.classification === 'income' && tx.type === 'expense') return false;
      if (candidate.classification === 'expense' && tx.type === 'income') return false;
      return true;
    });

    if (similarTx) {
      const similarAcc = accountsById.get(similarTx.accountId);
      const tokenOverlap = sharesDescriptiveTokens(
        `${candidate.merchant ?? ''} ${candidate.description} ${candidate.institution ?? ''}`,
        `${similarTx.description} ${similarTx.notes ?? ''} ${similarAcc?.name ?? ''}`
      );
      const isCardOverlap =
        candidate.isCreditCardNotification || similarAcc?.type === 'credit_card';

      duplicateWarnings.push({
        kind: isCardOverlap ? 'credit_card_notification' : 'amount_date_match',
        severity: 'warning',
        message: isCardOverlap
          ? `Potential credit card duplicate: matches "${similarTx.description}" (${similarTx.date}, ${similarTx.currency} ${similarTx.amount})${tokenOverlap ? ' with matching merchant/source.' : '.'}`
          : `Similar transaction already exists: "${similarTx.description}" on ${similarTx.date} (${similarTx.currency} ${similarTx.amount})${tokenOverlap ? ' (similar merchant/description).' : '.'}`,
        matchedTransactionId: similarTx.id,
      });
    }
  }

  return {
    ...candidate,
    duplicateWarnings,
    historyStatus: historyMatch?.status,
    matchedTransactionId:
      historyMatch?.matchedTransactionId ?? directEmailLinkedTx?.id,
    matchedHistoryId: historyMatch?.id,
    alreadyProcessed:
      Boolean(directEmailLinkedTx) ||
      historyMatch?.status === 'imported' ||
      historyMatch?.status === 'skipped' ||
      historyMatch?.status === 'duplicate',
  };
}

export async function evaluateCandidatesLocally(
  candidates: ParsedEmailTransactionCandidate[],
  recordOrigin: RecordOrigin = 'user'
): Promise<EvaluatedEmailCandidate[]> {
  const [accounts, existingTransactions, existingHistory] = await Promise.all([
    recordOrigin === 'test'
      ? accountsRepository.getTestRecords()
      : accountsRepository.getUserRecords(),
    recordOrigin === 'test'
      ? transactionsRepository.getTestRecords()
      : transactionsRepository.getUserRecords(),
    emailImportHistoryRepository.getAll(),
  ]);

  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  return candidates.map((candidate) =>
    evaluateCandidateDuplicates(
      candidate,
      existingTransactions,
      existingHistory,
      accountsById
    )
  );
}

export async function syncGmailTransactions(options: {
  filters: GmailSyncFilters;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  recordOrigin?: RecordOrigin;
}): Promise<GmailSyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl('/api/gmail/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.filters),
    cache: 'no-store',
  });

  const payload = (await res.json().catch(() => null)) as
    | {
        candidates?: ParsedEmailTransactionCandidate[];
        discoveredCount?: number;
        extractedCount?: number;
        failedCount?: number;
        nextPageToken?: string;
        syncCompletedAt?: string;
        error?: string;
        code?: string;
      }
    | null;

  if (!res.ok) {
    if (res.status === 401 || payload?.code === 'TOKEN_EXPIRED') {
      await markGmailTokenExpired();
    }
    throw new Error(
      payload?.error || `Gmail sync failed with HTTP ${res.status}.`
    );
  }

  const rawCandidates = Array.isArray(payload?.candidates)
    ? payload.candidates
    : [];
  const evaluated = await evaluateCandidatesLocally(
    rawCandidates,
    options.recordOrigin ?? 'user'
  );

  const lastSyncedAt = payload?.syncCompletedAt ?? nowIso();
  await recordGmailSyncMetadata({
    lastSyncedAt,
    syncCursor: payload?.nextPageToken,
  });

  const metrics = {
    discoveredCount: payload?.discoveredCount ?? evaluated.length,
    extractedCount: payload?.extractedCount ?? evaluated.length,
    readyCount: evaluated.filter((c) => c.extractionStatus === 'ready').length,
    needsReviewCount: evaluated.filter(
      (c) => c.extractionStatus !== 'ready'
    ).length,
    duplicateWarningCount: evaluated.filter(
      (c) => c.duplicateWarnings.length > 0
    ).length,
    alreadyProcessedCount: evaluated.filter((c) => c.alreadyProcessed).length,
    failedCount: payload?.failedCount ?? 0,
    lastSyncedAt,
    nextPageToken: payload?.nextPageToken,
    dateFrom: options.filters.dateFrom,
    dateTo: options.filters.dateTo,
  };

  return {
    candidates: evaluated,
    metrics,
  };
}

async function resolveHistoryContext(): Promise<{
  connectionId: string;
  installationId: string;
}> {
  const [installation, connection] = await Promise.all([
    appInstallationRepository.getSingleton(),
    getCurrentGmailConnection(),
  ]);
  return {
    installationId: installation?.installationId ?? 'local-default-installation',
    connectionId: connection?.id ?? 'gmail-unlinked-session',
  };
}

async function upsertEmailImportHistoryRow(params: {
  externalMessageId: string;
  subjectSummary: string;
  receivedAt: string;
  status: EmailImportStatus;
  matchedTransactionId?: string;
  errorMessage?: string;
}): Promise<EmailImportHistory> {
  const ctx = await resolveHistoryContext();
  const processedAt = nowIso();
  const existing = (await emailImportHistoryRepository.getAll()).find(
    (row) => row.externalMessageId === params.externalMessageId
  );

  if (existing) {
    return emailImportHistoryRepository.update(existing.id, {
      connectionId: ctx.connectionId,
      installationId: ctx.installationId,
      subjectSummary: params.subjectSummary.slice(0, 140),
      receivedAt: params.receivedAt,
      processedAt,
      status: params.status,
      matchedTransactionId: params.matchedTransactionId,
      errorMessage: params.errorMessage,
    });
  }

  return emailImportHistoryRepository.create({
    connectionId: ctx.connectionId,
    installationId: ctx.installationId,
    externalMessageId: params.externalMessageId,
    subjectSummary: params.subjectSummary.slice(0, 140),
    receivedAt: params.receivedAt,
    processedAt,
    status: params.status,
    matchedTransactionId: params.matchedTransactionId,
    errorMessage: params.errorMessage,
  });
}

export async function approveImportedCandidate(
  candidate: ParsedEmailTransactionCandidate,
  input: ApproveEmailImportInput,
  options?: { recordOrigin?: RecordOrigin; allowDuplicateOverride?: boolean }
): Promise<{ transaction: Transaction; history: EmailImportHistory }> {
  const origin: RecordOrigin = options?.recordOrigin ?? 'user';

  if (candidate.classification === 'investment' && input.type === 'expense') {
    throw new ValidationError(
      'Investment-related emails cannot be imported as ordinary expenses. Record them in the Investments module instead, or ignore this candidate.'
    );
  }

  const existingTransactions =
    origin === 'test'
      ? await transactionsRepository.getTestRecords()
      : await transactionsRepository.getUserRecords();

  const alreadyImportedTx = existingTransactions.find(
    (tx) => tx.emailImportId === candidate.externalMessageId
  );
  if (alreadyImportedTx && !options?.allowDuplicateOverride) {
    throw new ValidationError(
      'This Gmail message has already been imported into your transaction ledger.'
    );
  }

  const mergedNotes = [
    input.notes?.trim(),
    candidate.referenceNumber ? `Ref: ${candidate.referenceNumber}` : undefined,
    candidate.institution ? `Email Source: ${candidate.institution}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  let createdTx: Transaction;
  try {
    createdTx = await createTransaction(
      {
        type: input.type,
        amount: input.amount,
        date: input.date,
        accountId: input.accountId,
        toAccountId: input.type === 'transfer' ? input.toAccountId : undefined,
        categoryId: input.type === 'transfer' ? undefined : input.categoryId,
        subcategoryId: input.type === 'transfer' ? undefined : input.subcategoryId,
        description: input.description,
        notes: mergedNotes || undefined,
        emailImportId: candidate.externalMessageId,
      },
      { recordOrigin: origin }
    );
  } catch (error) {
    if (!(error instanceof ValidationError)) {
      await upsertEmailImportHistoryRow({
        externalMessageId: candidate.externalMessageId,
        subjectSummary: candidate.subjectSummary,
        receivedAt: candidate.receivedAt,
        status: 'failed',
        errorMessage:
          error instanceof Error ? error.message : 'Failed to create ledger transaction.',
      });
    }
    throw error;
  }

  const history = await upsertEmailImportHistoryRow({
    externalMessageId: candidate.externalMessageId,
    subjectSummary: candidate.subjectSummary,
    receivedAt: candidate.receivedAt,
    status: 'imported',
    matchedTransactionId: createdTx.id,
  });

  return { transaction: createdTx, history };
}

export async function rejectImportedCandidate(
  candidate: ParsedEmailTransactionCandidate,
  status: Extract<EmailImportStatus, 'skipped' | 'duplicate'> = 'skipped',
  reason?: string
): Promise<EmailImportHistory> {
  return upsertEmailImportHistoryRow({
    externalMessageId: candidate.externalMessageId,
    subjectSummary: candidate.subjectSummary,
    receivedAt: candidate.receivedAt,
    status,
    errorMessage: reason?.trim() || undefined,
  });
}

export async function recordFailedImportAttempt(
  candidate: ParsedEmailTransactionCandidate,
  errorMessage: string
): Promise<EmailImportHistory> {
  return upsertEmailImportHistoryRow({
    externalMessageId: candidate.externalMessageId,
    subjectSummary: candidate.subjectSummary,
    receivedAt: candidate.receivedAt,
    status: 'failed',
    errorMessage: errorMessage.slice(0, 240),
  });
}

export async function listGmailImportHistory(limit = 100): Promise<EmailImportHistory[]> {
  const rows = await emailImportHistoryRepository.getAll();
  return [...rows]
    .sort((a, b) => b.processedAt.localeCompare(a.processedAt))
    .slice(0, Math.max(1, limit));
}
