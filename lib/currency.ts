import { APP_CONFIG } from '@/lib/config';
import { roundToDecimals } from '@/lib/precision';
import { getPrivacyModeSnapshot, PRIVACY_MASK } from '@/lib/privacy-mode';

const ZERO_DECIMAL_CURRENCIES = new Set(['IDR', 'JPY', 'KRW', 'VND']);
const NON_ISO_CURRENCIES = new Set(['USDT', 'USDC', 'BUSD', 'DAI', 'BTC', 'ETH', 'SOL']);

export const SUPPORTED_CURRENCIES = APP_CONFIG.supportedCurrencies;

const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

export function getCurrencyDecimals(currency: string = APP_CONFIG.defaultCurrency): number {
  const code = currency.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (code === 'BTC' || code === 'ETH') return 6;
  return 2;
}

function getCurrencyFormatter(currency: string, locale: string): Intl.NumberFormat {
  const code = currency.toUpperCase();
  const key = `${locale}::${code}`;
  const existing = currencyFormatterCache.get(key);
  if (existing) return existing;

  const decimals = getCurrencyDecimals(code);
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  currencyFormatterCache.set(key, formatter);
  return formatter;
}

export function formatCurrency(
  amount: number,
  currency: string = APP_CONFIG.defaultCurrency,
  locale: string = APP_CONFIG.defaultLocale
): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const code = (currency || APP_CONFIG.defaultCurrency).toUpperCase();
  const decimals = getCurrencyDecimals(code);

  if (getPrivacyModeSnapshot()) {
    if (NON_ISO_CURRENCIES.has(code)) return `${PRIVACY_MASK} ${code}`;
    try {
      let maskedValueAdded = false;
      return getCurrencyFormatter(code, locale)
        .formatToParts(0)
        .map((part) => {
          if (['integer', 'group', 'decimal', 'fraction'].includes(part.type)) {
            if (maskedValueAdded) return '';
            maskedValueAdded = true;
            return PRIVACY_MASK;
          }
          return part.value;
        })
        .join('');
    } catch {
      return `${code} ${PRIVACY_MASK}`;
    }
  }

  if (NON_ISO_CURRENCIES.has(code)) {
    const formattedNumber = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(safeAmount);
    return `${formattedNumber} ${code}`;
  }

  try {
    return getCurrencyFormatter(code, locale).format(safeAmount);
  } catch {
    return `${code} ${safeAmount.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`;
  }
}

export function formatNumericValue(
  value: number,
  fractionDigits = 0,
  locale: string = APP_CONFIG.defaultLocale
): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(safeValue);
}

export function roundCurrencyAmount(
  amount: number,
  currency: string = APP_CONFIG.defaultCurrency
): number {
  if (!Number.isFinite(amount)) return 0;
  return roundToDecimals(amount, getCurrencyDecimals(currency));
}

