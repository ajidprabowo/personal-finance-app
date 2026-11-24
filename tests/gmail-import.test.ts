import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ensureDatabaseOpen, resetDatabaseInstance } from '@/database/client';
import {
  isImportableTransactionCandidate,
  parseEmailInputToCandidate,
  parseGmailRawMessage,
} from '@/lib/gmail-parser';
import {
  buildGmailSearchQuery,
  GmailServerError,
  syncGmailMessagesServer,
  validateSyncFiltersInput,
} from '@/lib/gmail-server';
import {
  emailConnectionsRepository,
  emailImportHistoryRepository,
  transactionsRepository,
} from '@/repositories';
import { getAccountBalancesSnapshot } from '@/services/account-balance.service';
import { getBudgetOverview } from '@/services/budget.service';
import { initializeApplication } from '@/services/bootstrap.service';
import { getDashboardOverview } from '@/services/dashboard.service';
import {
  disconnectGmailMetadata,
  getCurrentGmailConnection,
  markGmailTokenExpired,
  recordGmailConnected,
  recordGmailSyncMetadata,
} from '@/services/gmail-connection.service';
import {
  approveImportedCandidate,
  evaluateCandidateDuplicates,
  listGmailImportHistory,
  recordFailedImportAttempt,
  rejectImportedCandidate,
  syncGmailTransactions,
} from '@/services/gmail-import.service';
import { createUserAccount, listUserCategoriesWithCounts } from '@/services/settings.service';
import { createCategoryBudget } from '@/services/budget.service';

async function resetLocalDatabaseForTest(): Promise<void> {
  const db = await ensureDatabaseOpen();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
    }
  });
  await initializeApplication();
}

function encodeBase64Url(text: string): string {
  return Buffer.from(text, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('Stage 8 — Gmail Integration, Deterministic Parsing, Deduplication & Import Engine', () => {
  beforeEach(async () => {
    resetDatabaseInstance();
    await resetLocalDatabaseForTest();
  });

  it('1. Parses synthetic bank, card, e-wallet, refund, transfer, investment, and ambiguous emails deterministically', () => {
    const outgoingTransfer = parseEmailInputToCandidate({
      externalMessageId: 'msg-transfer-out-1',
      from: 'BCA Alert <bca@klikbca.com>',
      subject: 'Notifikasi Transfer Berhasil - MyBCA',
      receivedAt: '2026-11-10T08:00:00.000Z',
      bodyText:
        'Transfer antar rekening berhasil.\nTanggal: 10/11/2026\nNominal: Rp 1.500.000,00\nKepada: Rekening Mandiri\nRef No: BCA99881122',
    });
    assert.equal(outgoingTransfer.classification, 'transfer');
    assert.equal(outgoingTransfer.amount, 1500000);
    assert.equal(outgoingTransfer.currency, 'IDR');
    assert.equal(outgoingTransfer.date, '2026-11-10');
    assert.equal(outgoingTransfer.institution, 'BCA');
    assert.equal(outgoingTransfer.referenceNumber, 'BCA99881122');
    assert.equal(outgoingTransfer.extractionStatus, 'ready');

    const incomingTransfer = parseEmailInputToCandidate({
      externalMessageId: 'msg-transfer-in-1',
      from: 'Bank Mandiri <notify@bankmandiri.co.id>',
      subject: 'Incoming Transfer Received',
      receivedAt: '2026-11-11T09:15:00.000Z',
      bodyText:
        'Incoming transfer credited.\nDate: 2026-11-11\nAmount: IDR 2.000.000\nDari: BCA Savings\nReference: MDR11223344',
    });
    assert.equal(incomingTransfer.classification, 'transfer');
    assert.equal(incomingTransfer.transferDirection, 'incoming');
    assert.equal(incomingTransfer.amount, 2000000);
    assert.equal(incomingTransfer.currency, 'IDR');

    const ewalletExpense = parseEmailInputToCandidate({
      externalMessageId: 'msg-ewallet-1',
      from: 'GoPay Receipt <receipt@gojek.com>',
      subject: 'Pembayaran GoPay Berhasil',
      receivedAt: '2026-11-12T12:30:00.000Z',
      bodyText:
        'Pembayaran QRIS berhasil.\nMerchant: Kopi Kenangan\nTanggal: 12 Nov 2026\nTotal: Rp 48.000\nTRX ID: GP-778899',
    });
    assert.equal(ewalletExpense.classification, 'expense');
    assert.equal(ewalletExpense.amount, 48000);
    assert.equal(ewalletExpense.currency, 'IDR');
    assert.equal(ewalletExpense.merchant, 'Kopi Kenangan');
    assert.equal(ewalletExpense.institution, 'GoPay');
    assert.equal(ewalletExpense.referenceNumber, 'GP-778899');
    assert.equal(ewalletExpense.extractionStatus, 'ready');

    const creditCardExpense = parseEmailInputToCandidate({
      externalMessageId: 'msg-cc-1',
      from: 'Visa Card Alerts <alerts@bankcard.example>',
      subject: 'Credit Card Purchase Alert',
      receivedAt: '2026-11-13T18:00:00.000Z',
      bodyText:
        'Your Visa credit card ending 4421 was charged.\nMerchant: Whole Foods Market\nDate: Nov 13, 2026\nAmount: $45.99\nApproval Code: AP992211',
    });
    assert.equal(creditCardExpense.classification, 'expense');
    assert.equal(creditCardExpense.isCreditCardNotification, true);
    assert.equal(creditCardExpense.amount, 45.99);
    assert.equal(creditCardExpense.currency, 'USD');
    assert.equal(creditCardExpense.date, '2026-11-13');

    const refundEmail = parseEmailInputToCandidate({
      externalMessageId: 'msg-refund-1',
      from: 'ShopeePay <no-reply@shopeepay.co.id>',
      subject: 'Pengembalian Dana (Refund) Diproses',
      receivedAt: '2026-11-14T10:00:00.000Z',
      bodyText:
        'Refund berhasil diproses ke saldo.\nMerchant: Tokopedia Store\nTanggal: 14-11-2026\nAmount: Rp 120.000\nRef: RF88221',
    });
    assert.equal(refundEmail.classification, 'income');
    assert.equal(refundEmail.amount, 120000);
    assert.equal(refundEmail.extractionStatus, 'needs_review');

    const investmentEmail = parseEmailInputToCandidate({
      externalMessageId: 'msg-inv-1',
      from: 'Stockbit Sekuritas <trade@stockbit.com>',
      subject: 'Order Filled: Buy BBCA Shares',
      receivedAt: '2026-11-15T07:00:00.000Z',
      bodyText:
        'Your stock buy order was executed.\nStock: BBCA 100 shares\nDate: 2026-11-15\nTotal: Rp 1.020.000\nOrder ID: SB-554433',
    });
    assert.equal(investmentEmail.classification, 'investment');
    assert.equal(investmentEmail.institution, 'Stockbit');
    assert.equal(investmentEmail.extractionStatus, 'needs_review');

    const ambiguousEmail = parseEmailInputToCandidate({
      externalMessageId: 'msg-ambig-1',
      from: 'updates@service.example',
      subject: 'Account Monthly Summary Ready',
      receivedAt: '2026-11-16T05:00:00.000Z',
      bodyText: 'Your monthly statement is ready to view inside your portal.',
    });
    assert.equal(ambiguousEmail.amount, null);
    assert.equal(ambiguousEmail.classification, 'unknown');
    assert.equal(ambiguousEmail.extractionStatus, 'ambiguous');

    const salaryIncome = parseEmailInputToCandidate({
      externalMessageId: 'msg-salary-1',
      from: 'Payroll <payroll@company.example>',
      subject: 'Salary credited successfully',
      receivedAt: '2026-11-17T05:00:00.000Z',
      bodyText: 'Your salary of IDR 8.500.000 was credited to your account on 2026-11-17.',
    });
    assert.equal(salaryIncome.classification, 'income');
    assert.equal(isImportableTransactionCandidate(salaryIncome), true);

    const applicationEmail = parseEmailInputToCandidate({
      externalMessageId: 'msg-job-1',
      from: 'Recruitment <jobs@company.example>',
      subject: 'Job application received',
      receivedAt: '2026-11-18T05:00:00.000Z',
      bodyText: 'Your application was received. Salary range: IDR 10.000.000 per month.',
    });
    assert.equal(applicationEmail.classification, 'unknown');
    assert.equal(isImportableTransactionCandidate(applicationEmail), false);

    const marketAlert = parseEmailInputToCandidate({
      externalMessageId: 'msg-market-1',
      from: 'Stockbit <news@stockbit.example>',
      subject: 'Stock market price alert',
      receivedAt: '2026-11-19T05:00:00.000Z',
      bodyText: 'BBCA price changed to IDR 10.000. This is a market update, not a trade.',
    });
    assert.equal(marketAlert.classification, 'unknown');
    assert.equal(isImportableTransactionCandidate(marketAlert), false);

    const unconfirmedPayment = parseEmailInputToCandidate({
      externalMessageId: 'msg-pending-1',
      from: 'Bank Alert <alert@bank.example>',
      subject: 'QRIS payment notice',
      receivedAt: '2026-11-20T05:00:00.000Z',
      bodyText: 'QRIS payment of IDR 25.000. Date: 2026-11-20.',
    });
    assert.equal(unconfirmedPayment.extractionStatus, 'needs_review');
    assert.ok(unconfirmedPayment.uncertainFields.includes('transaction_status'));
    assert.equal(isImportableTransactionCandidate(unconfirmedPayment), true);
  });

  it('2. Decodes MIME HTML Gmail payloads safely and executes server-side sync with pagination, 429 retry, and 401 expiry', async () => {
    const validFilters = validateSyncFiltersInput({
      dateFrom: '2026-11-01',
      dateTo: '2026-11-20',
      sender: 'bca.co.id',
      subjectKeyword: 'Transfer',
      maxResults: 10,
    });
    const query = buildGmailSearchQuery(validFilters);
    assert.match(query, /after:2026\/11\/01/);
    assert.match(query, /before:2026\/11\/21/);
    assert.match(query, /from:\(bca\.co\.id\)/);
    assert.match(query, /subject:\(Transfer\)/);
    assert.match(query, /-newsletter/);
    assert.match(query, /-"monthly statement"/);

    // Mock 429 rate-limit once then succeed on list + message fetch
    let listCalls = 0;
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        listCalls += 1;
        if (listCalls === 1) {
          return new Response(JSON.stringify({ error: 'rate limit' }), {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(
          JSON.stringify({
            messages: [{ id: 'gmail-html-1', threadId: 'th-1' }],
            nextPageToken: 'page-2-token',
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          id: 'gmail-html-1',
          threadId: 'th-1',
          payload: {
            headers: [
              { name: 'From', value: 'GoPay <receipt@gojek.com>' },
              { name: 'Subject', value: 'Struk Pembayaran GoPay' },
              { name: 'Date', value: 'Fri, 20 Nov 2026 10:00:00 +0700' },
            ],
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/html',
                body: {
                  data: encodeBase64Url(
                    '<div><p>Pembayaran berhasil</p><p>Merchant: Bakmi GM</p><p>Total: Rp 65.000</p><p>Tanggal: 20/11/2026</p></div>'
                  ),
                },
              },
            ],
          },
        }),
        { status: 200 }
      );
    };

    const syncRes = await syncGmailMessagesServer('access-token-123456', validFilters, {
      fetchImpl: mockFetch,
      retryDelayMs: 5,
    });
    assert.equal(listCalls, 2);
    assert.equal(syncRes.discoveredCount, 1);
    assert.equal(syncRes.extractedCount, 1);
    assert.equal(syncRes.nextPageToken, 'page-2-token');
    assert.equal(syncRes.candidates[0].amount, 65000);
    assert.equal(syncRes.candidates[0].merchant, 'Bakmi GM');
    assert.equal('bodyText' in syncRes.candidates[0], false);

    // Expired token -> 401 TOKEN_EXPIRED
    await assert.rejects(
      () =>
        syncGmailMessagesServer('expired-token-1234', validFilters, {
          fetchImpl: async () => new Response('{}', { status: 401 }),
        }),
      (err: unknown) => err instanceof GmailServerError && err.code === 'TOKEN_EXPIRED'
    );
  });

  it('3. Approves imports through Stage 3 transaction engine, blocks investment-as-expense, prevents duplicates, and preserves ledger on disconnect', async () => {
    const bankAccount = await createUserAccount({
      name: 'BCA Main',
      type: 'bank',
      currency: 'IDR',
      initialBalance: 5_000_000,
    });
    const ewalletAccount = await createUserAccount({
      name: 'GoPay Wallet',
      type: 'ewallet',
      currency: 'IDR',
      initialBalance: 500_000,
    });
    const { categories } = await listUserCategoriesWithCounts();
    const foodCat = categories.find((c) => c.name === 'Food and Beverage')!;

    await createCategoryBudget({
      categoryId: foodCat.id,
      period: 'monthly',
      year: 2026,
      month: 11,
      limitAmount: 1_000_000,
      currency: 'IDR',
    });

    // Connect Gmail metadata and verify NO token stored in IndexedDB
    const conn = await recordGmailConnected('user.finance@gmail.com');
    assert.equal(conn.status, 'connected');
    assert.equal(conn.emailAddress, 'user.finance@gmail.com');
    const serializedConn = JSON.stringify(await emailConnectionsRepository.getAll());
    assert.equal(serializedConn.includes('accessToken'), false);
    assert.equal(serializedConn.includes('refreshToken'), false);

    // 1. Approve Expense
    const expenseCandidate = parseEmailInputToCandidate({
      externalMessageId: 'gmail-exp-100',
      from: 'GoPay <receipt@gojek.com>',
      subject: 'Pembayaran GoPay Berhasil',
      receivedAt: '2026-11-18T10:00:00.000Z',
      bodyText:
        'Pembayaran berhasil.\nMerchant: Warung Nusantara\nTanggal: 2026-11-18\nAmount: Rp 150.000\nRef: GP100',
    });

    const approvedExpense = await approveImportedCandidate(expenseCandidate, {
      type: 'expense',
      amount: 150_000,
      date: '2026-11-18',
      accountId: ewalletAccount.id,
      categoryId: foodCat.id,
      description: expenseCandidate.description,
    });
    assert.equal(approvedExpense.transaction.emailImportId, 'gmail-exp-100');
    assert.equal(approvedExpense.history.status, 'imported');

    // 2. Approve Internal Transfer (must NOT inflate income/expense)
    const transferCandidate = parseEmailInputToCandidate({
      externalMessageId: 'gmail-trf-200',
      from: 'BCA <bca@klikbca.com>',
      subject: 'Top Up GoPay Berhasil',
      receivedAt: '2026-11-19T11:00:00.000Z',
      bodyText:
        'Top up berhasil.\nTanggal: 2026-11-19\nAmount: Rp 1.000.000\nRef: BCA200',
    });

    await approveImportedCandidate(transferCandidate, {
      type: 'transfer',
      amount: 1_000_000,
      date: '2026-11-19',
      accountId: bankAccount.id,
      toAccountId: ewalletAccount.id,
      description: 'Top Up GoPay from BCA',
    });

    // Verify balances, budgets, and dashboard totals
    const balances = await getAccountBalancesSnapshot({ recordOrigin: 'user' });
    const bcaBal = balances.items.find((i) => i.account.id === bankAccount.id)!.currentBalance;
    const gopayBal = balances.items.find((i) => i.account.id === ewalletAccount.id)!.currentBalance;
    assert.equal(bcaBal, 4_000_000);
    assert.equal(gopayBal, 1_350_000);

    const budgetOverview = await getBudgetOverview({ year: 2026, month: 11 });
    assert.equal(budgetOverview.totalActualSpending, 150_000);

    const dash = await getDashboardOverview({
      preset: 'custom',
      customStart: '2026-11-01',
      customEnd: '2026-11-30',
    });
    assert.equal(dash.cashFlow.totalIncome, 0);
    assert.equal(dash.cashFlow.totalExpenses, 150_000);

    // 3. Block investment email from importing as ordinary expense
    const investmentCandidate = parseEmailInputToCandidate({
      externalMessageId: 'gmail-inv-300',
      from: 'Stockbit <trade@stockbit.com>',
      subject: 'Order Filled: Buy TLKM',
      receivedAt: '2026-11-20T09:00:00.000Z',
      bodyText: 'Stock buy order filled.\nTanggal: 2026-11-20\nAmount: Rp 500.000',
    });
    await assert.rejects(() =>
      approveImportedCandidate(investmentCandidate, {
        type: 'expense',
        amount: 500_000,
        date: '2026-11-20',
        accountId: bankAccount.id,
        categoryId: foodCat.id,
        description: 'Buy TLKM',
      })
    );

    // 4. Reject/Ignore candidate & Failed attempt logging
    await rejectImportedCandidate(investmentCandidate, 'skipped', 'Recorded separately in Investments');
    await recordFailedImportAttempt(
      parseEmailInputToCandidate({
        externalMessageId: 'gmail-fail-400',
        from: 'unknown@bank.example',
        subject: 'Incomplete Notice',
        receivedAt: '2026-11-20T12:00:00.000Z',
        bodyText: 'Statement ready',
      }),
      'Missing amount'
    );

    const historyRows = await listGmailImportHistory();
    assert.equal(historyRows.length, 4);
    assert.equal(historyRows.some((r) => r.status === 'skipped'), true);
    assert.equal(historyRows.some((r) => r.status === 'failed'), true);
    const historyJson = JSON.stringify(await emailImportHistoryRepository.getAll());
    assert.equal(historyJson.includes('Pembayaran berhasil'), false); // No raw email body stored

    // 5. Duplicate detection: exact message ID + financial heuristic (same amount/date/ref)
    const allTx = await transactionsRepository.getUserRecords();
    const allHistory = await emailImportHistoryRepository.getAll();
    const accountsById = new Map([
      [bankAccount.id, bankAccount],
      [ewalletAccount.id, ewalletAccount],
    ]);

    const exactDupEval = evaluateCandidateDuplicates(
      expenseCandidate,
      allTx,
      allHistory,
      accountsById
    );
    assert.equal(exactDupEval.alreadyProcessed, true);
    assert.equal(
      exactDupEval.duplicateWarnings.some((w) => w.kind === 'exact_message_imported'),
      true
    );

    const heuristicDupCandidate = parseEmailInputToCandidate({
      externalMessageId: 'gmail-exp-100-second-copy',
      from: 'Visa Card <alerts@bank.example>',
      subject: 'Credit Card Notification - Warung Nusantara',
      receivedAt: '2026-11-18T10:05:00.000Z',
      bodyText:
        'Credit card transaction.\nMerchant: Warung Nusantara\nDate: 2026-11-18\nAmount: Rp 150.000\nRef: GP100',
    });
    const heuristicEval = evaluateCandidateDuplicates(
      heuristicDupCandidate,
      allTx,
      allHistory,
      accountsById
    );
    assert.equal(heuristicEval.alreadyProcessed, false);
    assert.equal(
      heuristicEval.duplicateWarnings.some((w) => w.kind === 'reference_match'),
      true
    );
    assert.equal(
      heuristicEval.duplicateWarnings.some((w) => w.kind === 'credit_card_notification'),
      true
    );

    // 6. Sync metadata & disconnect preservation
    await recordGmailSyncMetadata({ lastSyncedAt: '2026-11-21T01:00:00.000Z' });
    await markGmailTokenExpired();
    const expiredConn = await getCurrentGmailConnection();
    assert.equal(expiredConn?.status, 'token_expired');

    await disconnectGmailMetadata();
    const disconnectedConn = await getCurrentGmailConnection();
    assert.equal(disconnectedConn?.status, 'disconnected');

    // Previously imported transactions remain intact after disconnecting Gmail
    const remainingTx = await transactionsRepository.getUserRecords();
    assert.equal(remainingTx.length, 2);

    // 7. syncGmailTransactions updates sync metadata and handles 401
    await recordGmailConnected('user.finance@gmail.com');
    const syncOutcome = await syncGmailTransactions({
      filters: { dateFrom: '2026-11-15', dateTo: '2026-11-21' },
      accessToken: 'mock-valid-token-1234',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            candidates: [expenseCandidate],
            discoveredCount: 1,
            extractedCount: 1,
            failedCount: 0,
            syncCompletedAt: '2026-11-21T02:00:00.000Z',
          }),
          { status: 200 }
        ),
    });
    assert.equal(syncOutcome.metrics.discoveredCount, 1);
    assert.equal(syncOutcome.metrics.alreadyProcessedCount, 1);

    await assert.rejects(() =>
      syncGmailTransactions({
        filters: { dateFrom: '2026-11-15', dateTo: '2026-11-21' },
        accessToken: 'mock-expired-token-123',
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: 'expired', code: 'TOKEN_EXPIRED' }), {
            status: 401,
          }),
      })
    );
    const after401Conn = await getCurrentGmailConnection();
    assert.equal(after401Conn?.status, 'token_expired');
  });
});
