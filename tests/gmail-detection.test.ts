import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isImportableTransactionCandidate,
  parseEmailInputToCandidate,
} from '@/lib/gmail-parser';
import { buildGmailSearchQuery } from '@/lib/gmail-server';

describe('Gmail financial transaction detection', () => {
  it('keeps confirmed payments, incoming money, and transfers for review/import', () => {
    const confirmedPayment = parseEmailInputToCandidate({
      externalMessageId: 'payment-1',
      from: 'GoPay <receipt@gojek.example>',
      subject: 'QRIS payment successful',
      receivedAt: '2026-11-20T12:00:00.000Z',
      bodyText: 'Paid to: Cafe. Total IDR 48.000. Date 2026-11-20. Status: successful.',
    });
    assert.equal(confirmedPayment.classification, 'expense');
    assert.equal(confirmedPayment.extractionStatus, 'ready');
    assert.equal(isImportableTransactionCandidate(confirmedPayment), true);

    const salary = parseEmailInputToCandidate({
      externalMessageId: 'salary-1',
      from: 'Payroll <payroll@company.example>',
      subject: 'Salary credited successfully',
      receivedAt: '2026-11-20T05:00:00.000Z',
      bodyText: 'Salary IDR 8.500.000 credited to account. Date 2026-11-20.',
    });
    assert.equal(salary.classification, 'income');
    assert.equal(isImportableTransactionCandidate(salary), true);

    const transfer = parseEmailInputToCandidate({
      externalMessageId: 'transfer-1',
      from: 'BCA <notify@bca.example>',
      subject: 'Outgoing transfer successful',
      receivedAt: '2026-11-20T06:00:00.000Z',
      bodyText: 'Transfer to: Savings. Amount IDR 500.000. Date 2026-11-20. Status successful.',
    });
    assert.equal(transfer.classification, 'transfer');
    assert.equal(isImportableTransactionCandidate(transfer), true);
  });

  it('marks weak transaction evidence for review and excludes irrelevant or investment mail', () => {
    const unconfirmed = parseEmailInputToCandidate({
      externalMessageId: 'pending-1',
      from: 'Bank <alerts@bank.example>',
      subject: 'QRIS payment notice',
      receivedAt: '2026-11-20T12:00:00.000Z',
      bodyText: 'Payment amount IDR 25.000. Date 2026-11-20.',
    });
    assert.equal(unconfirmed.extractionStatus, 'needs_review');
    assert.ok(unconfirmed.uncertainFields.includes('transaction_status'));

    const irrelevant = [
      ['Job application received', 'Your application and salary range are listed as IDR 10.000.000.'],
      ['Monthly account statement', 'Statement balance IDR 1.000.000.'],
      ['Stock market price alert', 'BBCA market price IDR 10.000; portfolio update only.'],
      ['OTP security alert', 'Your one-time password is 123456.'],
      ['Weekly newsletter promotion', 'Get 20% off your next purchase.'],
    ];
    for (const [subject, bodyText] of irrelevant) {
      const candidate = parseEmailInputToCandidate({
        externalMessageId: `irrelevant-${subject}`,
        from: 'Updates <news@example.test>',
        subject,
        receivedAt: '2026-11-20T12:00:00.000Z',
        bodyText,
      });
      assert.equal(isImportableTransactionCandidate(candidate), false, subject);
    }

    const investment = parseEmailInputToCandidate({
      externalMessageId: 'investment-1',
      from: 'Broker <trade@broker.example>',
      subject: 'Buy order filled',
      receivedAt: '2026-11-20T12:00:00.000Z',
      bodyText: 'Buy order executed. Stock XYZ. Total IDR 1.000.000. Date 2026-11-20.',
    });
    assert.equal(isImportableTransactionCandidate(investment), false);
  });

  it('uses Gmail search include and exclude terms', () => {
    const query = buildGmailSearchQuery({ dateFrom: '2026-11-01', dateTo: '2026-11-20' });
    assert.match(query, /\{payment pembayaran purchase/);
    assert.match(query, /-newsletter/);
    assert.match(query, /-"monthly statement"/);
    assert.match(query, /-OTP/);
  });
});
