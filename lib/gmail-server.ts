import { isValidDateString, shiftCalendarDays } from '@/lib/dates';
import {
  isImportableTransactionCandidate,
  parseGmailRawMessage,
  type GmailRawMessage,
} from '@/lib/gmail-parser';
import type {
  GmailSyncFilters,
  ParsedEmailTransactionCandidate,
} from '@/types/gmail-import';

export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailServerError extends Error {
  public readonly status: number;
  public readonly code:
    | 'UNAUTHORIZED'
    | 'TOKEN_EXPIRED'
    | 'INSUFFICIENT_SCOPE'
    | 'RATE_LIMITED'
    | 'VALIDATION_ERROR'
    | 'UPSTREAM_ERROR';

  constructor(
    message: string,
    status: number,
    code: GmailServerError['code']
  ) {
    super(message);
    this.name = 'GmailServerError';
    this.status = status;
    this.code = code;
  }
}

function sanitizeQueryToken(input: string): string {
  return input
    .replace(/[\r\n"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function buildGmailSearchQuery(filters: GmailSyncFilters): string {
  const parts: string[] = [];
  const transactionTerms =
    '{payment pembayaran purchase pembelian belanja debit charged QRIS transfer transaksi berhasil sukses received diterima credit credited salary gaji refund refunded reimbursement payroll receipt struk mutasi topup "money received"}';
  const excludedTerms = [
    '-"job application"', '-recruitment', '-newsletter', '-promotion', '-promo',
    '-OTP', '-"one-time password"', '-"verification code"', '-"security alert"',
    '-"new login"', '-"market update"', '-"price alert"', '-"stock market"',
    '-"portfolio update"', '-"investment news"', '-"account statement"',
    '-"monthly statement"', '-"e-statement"',
  ];

  if (isValidDateString(filters.dateFrom)) {
    parts.push(`after:${filters.dateFrom.replace(/-/g, '/')}`);
  }
  if (isValidDateString(filters.dateTo)) {
    const exclusiveEnd = shiftCalendarDays(filters.dateTo, 1);
    parts.push(`before:${exclusiveEnd.replace(/-/g, '/')}`);
  }

  const sender = sanitizeQueryToken(filters.sender ?? '');
  if (sender) {
    parts.push(`from:(${sender})`);
  }

  const subject = sanitizeQueryToken(filters.subjectKeyword ?? '');
  if (subject) {
    parts.push(`subject:(${subject})`);
  }

  const keywords = sanitizeQueryToken(filters.keywords ?? '');
  parts.push(transactionTerms);
  if (keywords) parts.push(`(${keywords})`);
  parts.push(...excludedTerms);

  return parts.join(' ').trim();
}

export function validateSyncFiltersInput(raw: unknown): GmailSyncFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GmailServerError('Invalid sync request payload.', 400, 'VALIDATION_ERROR');
  }
  const obj = raw as Record<string, unknown>;
  const dateFrom = typeof obj.dateFrom === 'string' ? obj.dateFrom.trim() : '';
  const dateTo = typeof obj.dateTo === 'string' ? obj.dateTo.trim() : '';

  if (!isValidDateString(dateFrom) || !isValidDateString(dateTo)) {
    throw new GmailServerError(
      'Valid dateFrom and dateTo (YYYY-MM-DD) are required.',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (dateFrom > dateTo) {
    throw new GmailServerError(
      'dateFrom must be earlier than or equal to dateTo.',
      400,
      'VALIDATION_ERROR'
    );
  }

  const maxResultsRaw =
    typeof obj.maxResults === 'number' && Number.isFinite(obj.maxResults)
      ? Math.trunc(obj.maxResults)
      : 25;
  const maxResults = Math.max(1, Math.min(maxResultsRaw, 50));

  const pageToken =
    typeof obj.pageToken === 'string' && obj.pageToken.trim()
      ? obj.pageToken.trim().slice(0, 512)
      : undefined;

  return {
    dateFrom,
    dateTo,
    sender: typeof obj.sender === 'string' ? obj.sender.trim().slice(0, 120) : undefined,
    subjectKeyword:
      typeof obj.subjectKeyword === 'string'
        ? obj.subjectKeyword.trim().slice(0, 120)
        : undefined,
    keywords: typeof obj.keywords === 'string' ? obj.keywords.trim().slice(0, 120) : undefined,
    maxResults,
    pageToken,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchGmailJson<T>(
  url: string,
  accessToken: string,
  options?: {
    fetchImpl?: typeof fetch;
    maxRetries?: number;
    retryDelayMs?: number;
  }
): Promise<T> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const maxRetries = options?.maxRetries ?? 2;
  const baseDelay = options?.retryDelayMs ?? 300;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (res.ok) {
      return (await res.json()) as T;
    }

    if (res.status === 401) {
      throw new GmailServerError(
        'Gmail session expired or unauthorized. Please reconnect Gmail.',
        401,
        'TOKEN_EXPIRED'
      );
    }

    if (res.status === 403) {
      throw new GmailServerError(
        'Gmail read-only permission was denied or insufficient.',
        403,
        'INSUFFICIENT_SCOPE'
      );
    }

    if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
      const retryAfterHeader = res.headers?.get?.('Retry-After');
      const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0 && retryAfterSec <= 5
          ? retryAfterSec * 1000
          : baseDelay * Math.pow(2, attempt);
      await sleep(waitMs);
      continue;
    }

    if (res.status === 429) {
      throw new GmailServerError(
        'Gmail API rate limit reached. Please wait a moment and retry.',
        429,
        'RATE_LIMITED'
      );
    }

    throw new GmailServerError(
      `Gmail API request failed with HTTP ${res.status}.`,
      res.status >= 400 && res.status < 600 ? res.status : 502,
      'UPSTREAM_ERROR'
    );
  }

  throw new GmailServerError('Gmail API request failed after retries.', 502, 'UPSTREAM_ERROR');
}

interface GmailListResponse {
  messages?: Array<{ id: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GmailServerProfileResult {
  emailAddress: string;
  messagesTotal?: number;
}

export async function fetchGmailProfileServer(
  accessToken: string,
  options?: { fetchImpl?: typeof fetch }
): Promise<GmailServerProfileResult> {
  const data = await fetchGmailJson<{ emailAddress?: string; messagesTotal?: number }>(
    `${GMAIL_API_BASE}/profile`,
    accessToken,
    options
  );
  if (!data.emailAddress) {
    throw new GmailServerError(
      'Unable to read Gmail account email address from profile.',
      502,
      'UPSTREAM_ERROR'
    );
  }
  return {
    emailAddress: data.emailAddress,
    messagesTotal: data.messagesTotal,
  };
}

export interface GmailServerSyncResponse {
  candidates: ParsedEmailTransactionCandidate[];
  discoveredCount: number;
  extractedCount: number;
  failedCount: number;
  nextPageToken?: string;
  query: string;
  syncCompletedAt: string;
}

export async function syncGmailMessagesServer(
  accessToken: string,
  filters: GmailSyncFilters,
  options?: {
    fetchImpl?: typeof fetch;
    retryDelayMs?: number;
  }
): Promise<GmailServerSyncResponse> {
  const query = buildGmailSearchQuery(filters);
  const searchParams = new URLSearchParams({
    q: query,
    maxResults: String(filters.maxResults ?? 25),
  });
  if (filters.pageToken) {
    searchParams.set('pageToken', filters.pageToken);
  }

  const listResult = await fetchGmailJson<GmailListResponse>(
    `${GMAIL_API_BASE}/messages?${searchParams.toString()}`,
    accessToken,
    options
  );

  const stubs = listResult.messages ?? [];
  const candidates: ParsedEmailTransactionCandidate[] = [];
  let failedCount = 0;

  const batchSize = 5;
  for (let i = 0; i < stubs.length; i += batchSize) {
    const batch = stubs.slice(i, i + batchSize);
    const settled = await Promise.allSettled(
      batch.map((stub) =>
        fetchGmailJson<GmailRawMessage>(
          `${GMAIL_API_BASE}/messages/${encodeURIComponent(stub.id)}?format=full`,
          accessToken,
          options
        )
      )
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        try {
          const candidate = parseGmailRawMessage(outcome.value);
          if (isImportableTransactionCandidate(candidate)) candidates.push(candidate);
        } catch {
          failedCount += 1;
        }
      } else {
        const err = outcome.reason;
        if (
          err instanceof GmailServerError &&
          (err.code === 'TOKEN_EXPIRED' ||
            err.code === 'INSUFFICIENT_SCOPE' ||
            err.code === 'RATE_LIMITED')
        ) {
          throw err;
        }
        failedCount += 1;
      }
    }
  }

  return {
    candidates,
    discoveredCount: stubs.length,
    extractedCount: candidates.length,
    failedCount,
    nextPageToken: listResult.nextPageToken,
    query,
    syncCompletedAt: new Date().toISOString(),
  };
}
