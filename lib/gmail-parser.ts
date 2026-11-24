import { APP_CONFIG } from '@/lib/config';
import { getTodayInTimezone, isValidDateString } from '@/lib/dates';
import type {
  EmailCandidateClassification,
  ExtractionStatus,
  ParsedEmailTransactionCandidate,
  TransferDirectionHint,
} from '@/types/gmail-import';

export interface GmailMessageHeader {
  name?: string;
  value?: string;
}

export interface GmailMessagePayloadPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: {
    size?: number;
    data?: string;
  };
  parts?: GmailMessagePayloadPart[];
}

export interface GmailRawMessage {
  id: string;
  threadId?: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailMessagePayloadPart;
}

export interface SyntheticEmailInput {
  externalMessageId: string;
  threadId?: string;
  from: string;
  subject: string;
  receivedAt: string;
  bodyText: string;
  bodyHtml?: string;
}

const MONTH_NAME_MAP: Record<string, number> = {
  jan: 1,
  january: 1,
  januari: 1,
  feb: 2,
  february: 2,
  februari: 2,
  mar: 3,
  march: 3,
  maret: 3,
  apr: 4,
  april: 4,
  may: 5,
  mei: 5,
  jun: 6,
  june: 6,
  juni: 6,
  jul: 7,
  july: 7,
  juli: 7,
  aug: 8,
  august: 8,
  agu: 8,
  agt: 8,
  agustus: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  okt: 10,
  oktober: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  des: 12,
  desember: 12,
};

const INSTITUTION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(bank\s+)?bca\b|klikbca|mybca/i, label: 'BCA' },
  { pattern: /\bmandiri\b|livin'?/i, label: 'Bank Mandiri' },
  { pattern: /\bbni\b|wondr/i, label: 'BNI' },
  { pattern: /\bbri\b|brimo/i, label: 'BRI' },
  { pattern: /\bcimb\b|octo/i, label: 'CIMB Niaga' },
  { pattern: /\bpermata\b/i, label: 'PermataBank' },
  { pattern: /\bjenius\b|\bbtpn\b/i, label: 'Jenius' },
  { pattern: /\bjago\b/i, label: 'Bank Jago' },
  { pattern: /\bseabank\b/i, label: 'SeaBank' },
  { pattern: /\bgopay\b|\bgojek\b/i, label: 'GoPay' },
  { pattern: /\bovo\b/i, label: 'OVO' },
  { pattern: /\bdana\b(?!\s+(masuk|keluar|tunai|investasi))/i, label: 'DANA' },
  { pattern: /\bshopeepay\b/i, label: 'ShopeePay' },
  { pattern: /\blinkaja\b/i, label: 'LinkAja' },
  { pattern: /\bstockbit\b/i, label: 'Stockbit' },
  { pattern: /\bpluang\b/i, label: 'Pluang' },
  { pattern: /\bbibit\b/i, label: 'Bibit' },
  { pattern: /\bbareksa\b/i, label: 'Bareksa' },
  { pattern: /\bajaib\b/i, label: 'Ajaib' },
  { pattern: /\bbitget\b/i, label: 'Bitget' },
  { pattern: /\bindodax\b/i, label: 'Indodax' },
  { pattern: /\binteractive\s+brokers\b|\bibkr\b/i, label: 'Interactive Brokers' },
  { pattern: /\bwise\b|transferwise/i, label: 'Wise' },
  { pattern: /\bpaypal\b/i, label: 'PayPal' },
  { pattern: /\bgrabpay\b|\bgrab\b/i, label: 'GrabPay' },
  { pattern: /\bvisa\b/i, label: 'Visa Card' },
  { pattern: /\bmastercard\b/i, label: 'Mastercard' },
  { pattern: /\bamex\b|american\s+express/i, label: 'American Express' },
];

export function decodeBase64UrlUtf8(encoded: string): string {
  if (!encoded) return '';
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }

  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Deterministic tag & entity stripping without any DOM/innerHTML usage.
 */
export function stripHtmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function collectMimeParts(
  part: GmailMessagePayloadPart | undefined,
  plainChunks: string[],
  htmlChunks: string[]
): void {
  if (!part) return;
  const mime = (part.mimeType ?? '').toLowerCase();
  const data = part.body?.data;

  if (data) {
    const decoded = decodeBase64UrlUtf8(data);
    if (mime === 'text/plain' || mime === '') {
      plainChunks.push(decoded);
    } else if (mime === 'text/html') {
      htmlChunks.push(decoded);
    }
  }

  if (Array.isArray(part.parts)) {
    for (const child of part.parts) {
      collectMimeParts(child, plainChunks, htmlChunks);
    }
  }
}

function getHeader(headers: GmailMessageHeader[] | undefined, targetName: string): string {
  if (!headers) return '';
  const targetLower = targetName.toLowerCase();
  const found = headers.find((h) => (h.name ?? '').toLowerCase() === targetLower);
  return (found?.value ?? '').trim();
}

function summarizeFromHeader(fromRaw: string): { display: string; email: string } {
  const cleaned = fromRaw.trim();
  const angleMatch = cleaned.match(/^(.*?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const display = angleMatch[1].replace(/^["']|["']$/g, '').trim();
    const email = angleMatch[2].trim();
    return { display: display || email, email };
  }
  return { display: cleaned || 'Unknown Sender', email: cleaned };
}

function parseReceivedIso(dateHeader: string, internalDate?: string): string {
  if (internalDate && /^\d+$/.test(internalDate)) {
    const ms = Number(internalDate);
    if (Number.isFinite(ms) && ms > 0) {
      return new Date(ms).toISOString();
    }
  }
  if (dateHeader) {
    const parsed = new Date(dateHeader);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  return new Date().toISOString();
}

function normalizeYmd(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDateString(candidate) ? candidate : null;
}

export function extractTransactionDateFromText(
  text: string,
  fallbackIso: string
): { date: string | null; inferredFromHeader: boolean } {
  // 1. YYYY-MM-DD (prefer explicit ISO date)
  const isoMatch = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const normalized = normalizeYmd(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (normalized) return { date: normalized, inferredFromHeader: false };
  }

  // 2. DD MMM YYYY or DD Month YYYY (e.g. 14 Nov 2026, 05 Mei 2026)
  const dmyWordMatch = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,10})\s+(20\d{2})\b/);
  if (dmyWordMatch) {
    const month = MONTH_NAME_MAP[dmyWordMatch[2].toLowerCase()];
    if (month) {
      const normalized = normalizeYmd(Number(dmyWordMatch[3]), month, Number(dmyWordMatch[1]));
      if (normalized) return { date: normalized, inferredFromHeader: false };
    }
  }

  // 3. MMM DD, YYYY (e.g. Nov 14, 2026)
  const mdyWordMatch = text.match(/\b([A-Za-z]{3,10})\s+(\d{1,2}),?\s+(20\d{2})\b/);
  if (mdyWordMatch) {
    const month = MONTH_NAME_MAP[mdyWordMatch[1].toLowerCase()];
    if (month) {
      const normalized = normalizeYmd(Number(mdyWordMatch[3]), month, Number(mdyWordMatch[2]));
      if (normalized) return { date: normalized, inferredFromHeader: false };
    }
  }

  // 4. DD/MM/YYYY or DD-MM-YYYY (Indonesian / international banking default DD/MM/YYYY, fallback MM/DD if month > 12)
  const slashMatch = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const year = Number(slashMatch[3]);
    if (second >= 1 && second <= 12) {
      const normalized = normalizeYmd(year, second, first);
      if (normalized) return { date: normalized, inferredFromHeader: false };
    }
    if (first >= 1 && first <= 12) {
      const normalized = normalizeYmd(year, first, second);
      if (normalized) return { date: normalized, inferredFromHeader: false };
    }
  }

  // 5. Fallback to email received header date in app default timezone
  const parsedFallback = new Date(fallbackIso);
  if (!Number.isNaN(parsedFallback.getTime())) {
    const ymd = getTodayInTimezone(APP_CONFIG.defaultTimezone, parsedFallback);
    if (isValidDateString(ymd)) {
      return { date: ymd, inferredFromHeader: true };
    }
  }

  return { date: null, inferredFromHeader: true };
}

/**
 * Parses Indonesian and international formatted numeric amounts accurately.
 */
export function parseMoneyNumber(rawNumber: string, currencyHint: string): number | null {
  let cleaned = rawNumber.trim().replace(/\s+/g, '').replace(/,-$/, '');
  if (!cleaned) return null;

  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const commaCount = (cleaned.match(/,/g) ?? []).length;

  if (dotCount > 0 && commaCount > 0) {
    const lastDot = cleaned.lastIndexOf('.');
    const lastComma = cleaned.lastIndexOf(',');
    if (lastComma > lastDot) {
      // e.g. 1.250.000,50 -> decimal comma
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      // e.g. 1,250,000.50 -> decimal dot
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (commaCount > 0) {
    const parts = cleaned.split(',');
    const lastPart = parts[parts.length - 1] ?? '';
    if (commaCount === 1 && lastPart.length <= 2) {
      // e.g. 150000,50
      cleaned = cleaned.replace(',', '.');
    } else {
      // e.g. 1,250,000
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (dotCount > 0) {
    const parts = cleaned.split('.');
    const lastPart = parts[parts.length - 1] ?? '';
    if (dotCount > 1) {
      // e.g. 1.250.000
      cleaned = cleaned.replace(/\./g, '');
    } else if (lastPart.length === 3 && (currencyHint === 'IDR' || Number(parts[0]) >= 1)) {
      // In Indonesian bank notifications (Rp 150.000), a single dot with 3 trailing digits is thousands separator,
      // except USD/EUR/SGD where e.g. 1.500 is ambiguous unless IDR context; for IDR treat .ddd as thousands.
      if (currencyHint === 'IDR' || parts[0].length <= 3) {
        cleaned = cleaned.replace('.', '');
      }
    }
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return currencyHint === 'IDR' ? Math.round(parsed) : Math.round(parsed * 100) / 100;
}

const CURRENCY_TOKEN_REGEX =
  /\b(Rp\.?|IDR|USD|EUR|SGD|MYR|JPY|GBP|AUD)\s*([0-9][0-9.,]*(?:,-)?)|([$€£¥])\s*([0-9][0-9.,]*)/gi;

function mapCurrencyToken(token: string): string {
  const upper = token.toUpperCase().replace('.', '');
  if (upper === 'RP' || upper === 'IDR') return 'IDR';
  if (upper === '$' || upper === 'USD') return 'USD';
  if (upper === '€' || upper === 'EUR') return 'EUR';
  if (upper === '£' || upper === 'GBP') return 'GBP';
  if (upper === '¥' || upper === 'JPY') return 'JPY';
  return upper;
}

export function extractMoneyFromText(
  subject: string,
  body: string
): { amount: number | null; currency: string | null; multipleCandidates: boolean } {
  const labeledLines = body
    .split(/\r?\n/)
    .filter((line) =>
      /\b(amount|total|nominal|jumlah|nilai|debit|credit|pembayaran|transfer|refund|price|harga)\b/i.test(
        line
      )
    );

  const searchSources = [labeledLines.join('\n'), subject, body];

  for (const source of searchSources) {
    if (!source) continue;
    CURRENCY_TOKEN_REGEX.lastIndex = 0;
    const matches: Array<{ currency: string; amount: number }> = [];
    let match: RegExpExecArray | null = CURRENCY_TOKEN_REGEX.exec(source);
    while (match !== null) {
      const token = match[1] ?? match[3] ?? '';
      const rawNum = match[2] ?? match[4] ?? '';
      const currency = mapCurrencyToken(token);
      const amount = parseMoneyNumber(rawNum, currency);
      if (amount !== null) {
        matches.push({ currency, amount });
      }
      match = CURRENCY_TOKEN_REGEX.exec(source);
    }
    if (matches.length > 0) {
      const uniqueValues = new Set(matches.map((m) => `${m.currency}:${m.amount}`));
      return {
        amount: matches[0].amount,
        currency: matches[0].currency,
        multipleCandidates: uniqueValues.size > 1 && source === body,
      };
    }
  }

  return { amount: null, currency: null, multipleCandidates: false };
}

export function extractReferenceNumber(text: string): string | undefined {
  const patterns = [
    /\b(?:no\.?\s*referensi|kode\s*referensi|reference\s*(?:no|number|id|code)?|ref(?:\s*no|\s*id)?|trx\s*id|transaction\s*id|id\s*transaksi|approval\s*code|order\s*id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,35})\b/i,
  ];
  for (const regex of patterns) {
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

export function extractInstitution(fromDisplay: string, fromEmail: string, fullText: string): string | undefined {
  const combined = `${fromDisplay} ${fromEmail} ${fullText}`;
  for (const entry of INSTITUTION_PATTERNS) {
    if (entry.pattern.test(combined)) {
      return entry.label;
    }
  }
  if (fromDisplay && fromDisplay !== fromEmail && !/@/.test(fromDisplay)) {
    return fromDisplay.slice(0, 48);
  }
  const domainMatch = fromEmail.match(/@([a-z0-9.-]+)/i);
  if (domainMatch?.[1]) {
    const root = domainMatch[1].split('.').slice(-2, -1)[0];
    if (root && root.length > 1) {
      return root.charAt(0).toUpperCase() + root.slice(1);
    }
  }
  return undefined;
}

export function extractMerchantOrCounterparty(text: string): string | undefined {
  const patterns = [
    /\b(?:merchant|outlet|toko|store|paid\s+to|kepada|penerima|beneficiary|recipient|to\s+merchant)\s*[:-]\s*([^\n\r;|]{2,64})/i,
    /\b(?:dari|pengirim|sender|from\s+account)\s*[:-]\s*([^\n\r;|]{2,64})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].trim().replace(/\s{2,}/g, ' ');
      if (candidate.length >= 2) {
        return candidate.slice(0, 64);
      }
    }
  }
  return undefined;
}

function detectClassification(
  subject: string,
  body: string,
  institution?: string
): {
  classification: EmailCandidateClassification;
  transferDirection?: TransferDirectionHint;
  isCreditCardNotification: boolean;
  uncertainClassification: boolean;
} {
  const text = `${subject}\n${body}`;
  const isCreditCardNotification =
    /\b(credit\s*card|kartu\s*kredit|visa|mastercard|amex|american\s+express|cc\s+alert|card\s+ending)\b/i.test(
      text
    );

  // 1. Investment-related activity (never import as ordinary expense)
  const isInvestmentInstitution =
    institution !== undefined &&
    ['Stockbit', 'Pluang', 'Bibit', 'Bareksa', 'Ajaib', 'Bitget', 'Indodax', 'Interactive Brokers'].includes(
      institution
    );
  const hasInvestmentKeywords =
    /\b(stock|shares|etf|mutual\s*fund|reksa\s*dana|saham|crypto|bitcoin|eth|usdt|portfolio|dividen|dividend|brokerage|order\s*(?:filled|executed)|buy\s+order|sell\s+order|beli\s+saham|jual\s+saham|rdn|custodian)\b/i.test(
      text
    );

  if (
    hasInvestmentKeywords ||
    (isInvestmentInstitution && /\b(buy|sell|beli|jual|deposit|top\s*up|dividend|order)\b/i.test(text))
  ) {
    return {
      classification: 'investment',
      isCreditCardNotification,
      uncertainClassification: false,
    };
  }

  // 2. Refund
  if (
    /\b(refund|refunded|pengembalian\s*dana|dana\s*dikembalikan|chargeback|reversal|reversed)\b/i.test(
      text
    )
  ) {
    return {
      classification: 'refund',
      isCreditCardNotification,
      uncertainClassification: false,
    };
  }

  // 3. Explicit Income (salary, payroll, invoice payment received, bonus)
  if (
    /\b(salary|gaji|payroll|invoice\s*paid|pembayaran\s*diterima|payment\s*received|royalty|honorarium|bunga\s*tabungan|interest\s*credited|you\s+received\s+a\s+payment)\b/i.test(
      text
    )
  ) {
    return {
      classification: 'income',
      isCreditCardNotification,
      uncertainClassification: false,
    };
  }

  // 4. Transfers (internal, incoming transfer, outgoing transfer, e-wallet top up)
  const isIncomingTransfer =
    /\b(incoming\s*transfer|transfer\s*masuk|dana\s*masuk|credit\s*transfer|received\s*transfer|menerima\s*transfer)\b/i.test(
      text
    );
  const isOutgoingTransfer =
    /\b(outgoing\s*transfer|transfer\s*keluar|transfer\s*ke\b|transfer\s*to\b|transfer\s*berhasil|sent\s*transfer)\b/i.test(
      text
    );
  const isInternalOrTopUpTransfer =
    /\b(internal\s*transfer|transfer\s*antar\s*rekening|pindah\s*buku|top\s*-?\s*up|isi\s*saldo|own\s*account)\b/i.test(
      text
    );

  if (isInternalOrTopUpTransfer || isIncomingTransfer || isOutgoingTransfer) {
    const transferDirection: TransferDirectionHint = isInternalOrTopUpTransfer
      ? 'internal'
      : isIncomingTransfer
        ? 'incoming'
        : 'outgoing';
    return {
      classification: 'transfer',
      transferDirection,
      isCreditCardNotification,
      uncertainClassification: isIncomingTransfer && !isInternalOrTopUpTransfer,
    };
  }

  // 5. Expense (debit card, credit card, QRIS, e-wallet payment, merchant receipt, bill payment)
  if (
    isCreditCardNotification ||
    /\b(debit|payment\s*(?:successful|confirmed|receipt)|pembayaran\s*(?:berhasil|sukses)|transaksi\s*(?:berhasil|sukses)|purchase|pembelian|belanja|qris|edc|bayar|tagihan|bill\s*payment|checkout|struk|receipt|spent|charged|penarikan|withdrawal)\b/i.test(
      text
    )
  ) {
    return {
      classification: 'expense',
      isCreditCardNotification,
      uncertainClassification: false,
    };
  }

  return {
    classification: 'unknown',
    isCreditCardNotification,
    uncertainClassification: true,
  };
}

function buildSuggestedDescription(params: {
  subject: string;
  merchant?: string;
  institution?: string;
  classification: EmailCandidateClassification;
  transferDirection?: TransferDirectionHint;
}): string {
  const { subject, merchant, institution, classification, transferDirection } = params;
  if (merchant && institution) {
    return `${merchant} (${institution})`;
  }
  if (merchant) {
    return merchant;
  }
  const cleanSubject = subject
    .replace(/^(re|fwd?)\s*:\s*/i, '')
    .replace(/\[[^\]]+\]\s*/g, '')
    .trim();
  if (cleanSubject) {
    return cleanSubject.slice(0, 96);
  }
  if (classification === 'transfer') {
    if (transferDirection === 'incoming') return `${institution ?? 'Bank'} Incoming Transfer`;
    if (transferDirection === 'outgoing') return `${institution ?? 'Bank'} Outgoing Transfer`;
    return `${institution ?? 'Account'} Internal Transfer`;
  }
  return `${institution ?? 'Email'} Transaction`;
}

export function parseEmailInputToCandidate(
  input: SyntheticEmailInput
): ParsedEmailTransactionCandidate {
  const fromInfo = summarizeFromHeader(input.from);
  const bodySource =
    input.bodyText.trim() || stripHtmlToText(input.bodyHtml ?? '');
  const fullText = `${input.subject}\n${bodySource}`;

  const institution = extractInstitution(fromInfo.display, fromInfo.email, fullText);
  const merchant = extractMerchantOrCounterparty(bodySource);
  const referenceNumber = extractReferenceNumber(fullText);
  const { amount, currency, multipleCandidates } = extractMoneyFromText(
    input.subject,
    bodySource
  );
  const { date, inferredFromHeader } = extractTransactionDateFromText(
    fullText,
    input.receivedAt
  );
  const {
    classification,
    transferDirection,
    isCreditCardNotification,
    uncertainClassification,
  } = detectClassification(input.subject, bodySource, institution);

  const uncertainFields: string[] = [];
  if (amount === null || currency === null) {
    uncertainFields.push('amount');
  } else if (multipleCandidates) {
    uncertainFields.push('amount_multiple');
  }
  if (!date) {
    uncertainFields.push('date');
  } else if (inferredFromHeader) {
    uncertainFields.push('date_inferred');
  }
  if (classification === 'unknown' || uncertainClassification) {
    uncertainFields.push('classification');
  }
  if (classification === 'refund') {
    uncertainFields.push('refund_mapping');
  }

  let extractionStatus: ExtractionStatus = 'ready';
  if (amount === null || currency === null || !date || classification === 'unknown') {
    extractionStatus = 'ambiguous';
  } else if (
    uncertainFields.length > 0 ||
    classification === 'investment' ||
    classification === 'refund'
  ) {
    extractionStatus = 'needs_review';
  }

  const description = buildSuggestedDescription({
    subject: input.subject,
    merchant,
    institution,
    classification,
    transferDirection,
  });

  const noteParts: string[] = [];
  if (institution) noteParts.push(`Source: ${institution}`);
  if (referenceNumber) noteParts.push(`Ref: ${referenceNumber}`);
  if (merchant) noteParts.push(`Counterparty: ${merchant}`);
  noteParts.push(`Gmail Msg: ${input.externalMessageId}`);

  return {
    externalMessageId: input.externalMessageId,
    threadId: input.threadId,
    receivedAt: input.receivedAt,
    subjectSummary: (input.subject || '(No Subject)').slice(0, 140),
    fromSummary: fromInfo.display.slice(0, 100),
    date,
    amount,
    currency,
    classification,
    transferDirection,
    description,
    merchant,
    institution,
    referenceNumber,
    isCreditCardNotification,
    extractionStatus,
    uncertainFields,
    notesSummary: noteParts.join(' · '),
  };
}

export function parseGmailRawMessage(raw: GmailRawMessage): ParsedEmailTransactionCandidate {
  const headers = raw.payload?.headers ?? [];
  const from = getHeader(headers, 'From');
  const subject = getHeader(headers, 'Subject');
  const dateHeader = getHeader(headers, 'Date');
  const receivedAt = parseReceivedIso(dateHeader, raw.internalDate);

  const plainChunks: string[] = [];
  const htmlChunks: string[] = [];
  collectMimeParts(raw.payload, plainChunks, htmlChunks);

  const bodyText =
    plainChunks.join('\n').trim() ||
    stripHtmlToText(htmlChunks.join('\n')) ||
    (raw.snippet ?? '');

  return parseEmailInputToCandidate({
    externalMessageId: raw.id,
    threadId: raw.threadId,
    from,
    subject,
    receivedAt,
    bodyText,
  });
}
