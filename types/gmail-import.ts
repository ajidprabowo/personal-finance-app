import type { EmailImportStatus, TransactionType } from '@/types/entities';

export type EmailCandidateClassification =
  | 'income'
  | 'expense'
  | 'transfer'
  | 'refund'
  | 'investment'
  | 'unknown';

export type ExtractionStatus = 'ready' | 'needs_review' | 'ambiguous';

export type TransferDirectionHint = 'incoming' | 'outgoing' | 'internal';

export type DuplicateWarningKind =
  | 'exact_message_imported'
  | 'exact_message_skipped'
  | 'exact_message_duplicate'
  | 'previous_failed'
  | 'reference_match'
  | 'amount_date_match'
  | 'credit_card_notification';

export interface DuplicateWarning {
  kind: DuplicateWarningKind;
  severity: 'info' | 'warning' | 'blocking';
  message: string;
  matchedTransactionId?: string;
  matchedHistoryId?: string;
}

export interface ParsedEmailTransactionCandidate {
  externalMessageId: string;
  threadId?: string;
  receivedAt: string;
  subjectSummary: string;
  fromSummary: string;
  date: string | null;
  amount: number | null;
  currency: string | null;
  classification: EmailCandidateClassification;
  transferDirection?: TransferDirectionHint;
  description: string;
  merchant?: string;
  institution?: string;
  referenceNumber?: string;
  isCreditCardNotification: boolean;
  extractionStatus: ExtractionStatus;
  uncertainFields: string[];
  notesSummary: string;
}

export interface EvaluatedEmailCandidate extends ParsedEmailTransactionCandidate {
  duplicateWarnings: DuplicateWarning[];
  historyStatus?: EmailImportStatus;
  matchedTransactionId?: string;
  matchedHistoryId?: string;
  alreadyProcessed: boolean;
}

export interface GmailSyncFilters {
  dateFrom: string;
  dateTo: string;
  sender?: string;
  subjectKeyword?: string;
  keywords?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface GmailSyncMetrics {
  discoveredCount: number;
  extractedCount: number;
  readyCount: number;
  needsReviewCount: number;
  duplicateWarningCount: number;
  alreadyProcessedCount: number;
  failedCount: number;
  lastSyncedAt: string;
  nextPageToken?: string;
  dateFrom: string;
  dateTo: string;
}

export interface GmailSyncResult {
  candidates: EvaluatedEmailCandidate[];
  metrics: GmailSyncMetrics;
}

export interface ApproveEmailImportInput {
  type: TransactionType;
  amount: number;
  date: string;
  accountId: string;
  toAccountId?: string;
  categoryId?: string;
  subcategoryId?: string;
  description: string;
  notes?: string;
}
