/**
 * Decimal-safe financial arithmetic helpers using scaled BigInt integers.
 * Avoids binary floating-point drift (e.g., 0.1 + 0.2 !== 0.3) in quantity,
 * unit price, average cost, and currency calculations.
 */

const INTERNAL_SCALE = 8;
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_TWO = BigInt(2);

function pow10BigInt(exp: number): bigint {
  const safeExp = Math.max(0, Math.floor(exp));
  return BigInt('1' + '0'.repeat(safeExp));
}

const SCALE_FACTOR = pow10BigInt(INTERNAL_SCALE);

function normalizeNumericString(value: number | string): string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '0';
    // Use toFixed with sufficient precision to eliminate exponential notation
    return value.toFixed(INTERNAL_SCALE);
  }
  const trimmed = value.trim();
  if (!trimmed) return '0';
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return '0';
  return parsed.toFixed(INTERNAL_SCALE);
}

export function toScaledBigInt(value: number | string, scale: number = INTERNAL_SCALE): bigint {
  const str = normalizeNumericString(value);
  const negative = str.startsWith('-');
  const unsigned = negative ? str.slice(1) : str;
  const [intPartRaw, fracPartRaw = ''] = unsigned.split('.');
  const intPart = intPartRaw.replace(/\D/g, '') || '0';
  const fracClean = fracPartRaw.replace(/\D/g, '');
  const paddedFrac = fracClean.padEnd(scale, '0').slice(0, scale);
  const extraDigit = fracClean.length > scale ? Number(fracClean[scale]) : 0;

  let scaled = BigInt(intPart) * pow10BigInt(scale) + BigInt(paddedFrac || '0');
  if (extraDigit >= 5) {
    scaled += BIGINT_ONE;
  }
  return negative ? -scaled : scaled;
}

export function fromScaledBigInt(scaled: bigint, scale: number = INTERNAL_SCALE): number {
  const negative = scaled < BIGINT_ZERO;
  const abs = negative ? -scaled : scaled;
  const factor = pow10BigInt(scale);
  const intPart = abs / factor;
  const fracPart = abs % factor;
  const fracStr = fracPart.toString().padStart(scale, '0').replace(/0+$/, '');
  const numStr = fracStr ? `${intPart}.${fracStr}` : `${intPart}`;
  const result = Number(negative ? `-${numStr}` : numStr);
  return Object.is(result, -0) ? 0 : result;
}

export function roundToDecimals(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const scaled = toScaledBigInt(value, decimals);
  return fromScaledBigInt(scaled, decimals);
}

export function roundQuantity(qty: number): number {
  return roundToDecimals(qty, 8);
}

export function roundUnitPrice(price: number): number {
  return roundToDecimals(price, 6);
}

export function addDecimal(a: number, b: number, decimals = INTERNAL_SCALE): number {
  const sum = toScaledBigInt(a, decimals) + toScaledBigInt(b, decimals);
  return fromScaledBigInt(sum, decimals);
}

export function subtractDecimal(a: number, b: number, decimals = INTERNAL_SCALE): number {
  const diff = toScaledBigInt(a, decimals) - toScaledBigInt(b, decimals);
  return fromScaledBigInt(diff, decimals);
}

export function multiplyDecimal(a: number, b: number, decimals = INTERNAL_SCALE): number {
  const sa = toScaledBigInt(a, INTERNAL_SCALE);
  const sb = toScaledBigInt(b, INTERNAL_SCALE);
  const rawProduct = sa * sb; // scale = 2 * INTERNAL_SCALE
  const divisor = pow10BigInt(2 * INTERNAL_SCALE - decimals);
  const half = divisor / BIGINT_TWO;
  const negative = rawProduct < BIGINT_ZERO;
  const absProd = negative ? -rawProduct : rawProduct;
  const rounded = (absProd + half) / divisor;
  return fromScaledBigInt(negative ? -rounded : rounded, decimals);
}

export function divideDecimal(numerator: number, denominator: number, decimals = INTERNAL_SCALE): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }
  const numScaled = toScaledBigInt(numerator, INTERNAL_SCALE);
  const denScaled = toScaledBigInt(denominator, INTERNAL_SCALE);
  if (denScaled === BIGINT_ZERO) return 0;

  const targetFactor = pow10BigInt(decimals);
  const negative = (numScaled < BIGINT_ZERO) !== (denScaled < BIGINT_ZERO);
  const absNum = numScaled < BIGINT_ZERO ? -numScaled : numScaled;
  const absDen = denScaled < BIGINT_ZERO ? -denScaled : denScaled;

  const scaledNumerator = absNum * targetFactor;
  const quotient = (scaledNumerator + absDen / BIGINT_TWO) / absDen;
  return fromScaledBigInt(negative ? -quotient : quotient, decimals);
}

export function allocateProportionalBasis(
  totalBasis: number,
  soldQty: number,
  totalQty: number,
  currencyDecimals: number
): number {
  if (totalQty <= 0 || soldQty <= 0 || totalBasis <= 0) return 0;
  const basisScaled = toScaledBigInt(totalBasis, currencyDecimals);
  const soldScaled = toScaledBigInt(soldQty, INTERNAL_SCALE);
  const totalScaled = toScaledBigInt(totalQty, INTERNAL_SCALE);
  if (totalScaled === BIGINT_ZERO) return 0;
  if (soldScaled >= totalScaled) {
    return fromScaledBigInt(basisScaled, currencyDecimals);
  }
  const numerator = basisScaled * soldScaled;
  const allocated = (numerator + totalScaled / BIGINT_TWO) / totalScaled;
  const clamped =
    allocated > basisScaled ? basisScaled : allocated < BIGINT_ZERO ? BIGINT_ZERO : allocated;
  return fromScaledBigInt(clamped, currencyDecimals);
}

export { SCALE_FACTOR };
