export const PRIVACY_MASK = '••••••';

let privacyModeEnabled = false;
const listeners = new Set<() => void>();

export function getPrivacyModeSnapshot(): boolean {
  return privacyModeEnabled;
}

export function setPrivacyModeSnapshot(enabled: boolean): void {
  if (privacyModeEnabled === enabled) return;
  privacyModeEnabled = enabled;
  for (const listener of listeners) listener();
}

export function subscribePrivacyMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function formatCompactFinancialAxis(value: number, locale: string): string {
  if (privacyModeEnabled) return PRIVACY_MASK;
  return new Intl.NumberFormat(locale, { notation: 'compact' }).format(value);
}

export function formatSensitiveNumber(value: number, fractionDigits = 1): string {
  return privacyModeEnabled ? PRIVACY_MASK : value.toFixed(fractionDigits);
}

export function formatSensitiveSignedNumber(value: number, fractionDigits = 1): string {
  if (privacyModeEnabled) return PRIVACY_MASK;
  return `${value > 0 ? '+' : ''}${value.toFixed(fractionDigits)}`;
}

export function formatPrivacySensitiveText(text: string): string {
  if (!privacyModeEnabled) return text;

  const preservedDates: string[] = [];
  const withDateTokens = text.replace(
    /\b\d{4}-\d{1,2}-\d{1,2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b/g,
    (date) => {
      const token = `\u0000DATE${'X'.repeat(preservedDates.length + 1)}\u0000`;
      preservedDates.push(date);
      return token;
    }
  );

  return withDateTokens
    .replace(/[+-](?=\s*(?:[$€£¥]|Rp|[A-Z]{3})?\s*\d)/g, '')
    .replace(/[-+]?\d[\d.,]*(?:%|x)?/g, PRIVACY_MASK)
    .replace(/\u0000DATEX+\u0000/g, (token) => {
      const index = token.length - '\u0000DATE\u0000'.length - 1;
      return preservedDates[index];
    });
}
