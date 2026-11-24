import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { formatCurrency } from '@/lib/currency';
import {
  formatPrivacySensitiveText,
  getPrivacyModeSnapshot,
  formatSensitiveNumber,
  formatSensitiveSignedNumber,
  setPrivacyModeSnapshot,
} from '@/lib/privacy-mode';

afterEach(() => setPrivacyModeSnapshot(false));

describe('Privacy mode display formatting', () => {
  it('masks currency values while preserving currency markers, then restores them', () => {
    const visibleUsd = formatCurrency(1234.56, 'USD', 'en-US');
    const visibleIdr = formatCurrency(1_234_567, 'IDR', 'id-ID');

    setPrivacyModeSnapshot(true);
    assert.equal(getPrivacyModeSnapshot(), true);
    const hiddenUsd = formatCurrency(1234.56, 'USD', 'en-US');
    const hiddenIdr = formatCurrency(1_234_567, 'IDR', 'id-ID');
    const hiddenBitcoin = formatCurrency(0.125, 'BTC', 'en-US');
    assert.match(hiddenUsd, /\$.*••••••/);
    assert.match(hiddenIdr, /Rp.*••••••/);
    assert.equal(hiddenBitcoin, '•••••• BTC');
    assert.equal(formatSensitiveNumber(42.5, 1), '••••••');
    assert.equal(formatSensitiveSignedNumber(-3.25, 2), '••••••');
    assert.doesNotMatch(hiddenUsd, /1,234|56/);
    assert.doesNotMatch(hiddenIdr, /1\.234|567/);
    assert.equal(
      formatPrivacySensitiveText('Net cash flow was +$1,234.56 on 2026-11-25.'),
      'Net cash flow was $•••••• on 2026-11-25.'
    );

    setPrivacyModeSnapshot(false);
    assert.equal(formatCurrency(1234.56, 'USD', 'en-US'), visibleUsd);
    assert.equal(formatCurrency(1_234_567, 'IDR', 'id-ID'), visibleIdr);
    assert.equal(formatSensitiveNumber(42.5, 1), '42.5');
  });
});
