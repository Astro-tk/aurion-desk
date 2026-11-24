/**
 * South African-first phone normalisation to E.164.
 *   "082 123 4567"      -> "+27821234567"
 *   "+27 82 123 4567"   -> "+27821234567"
 *   "0027821234567"     -> "+27821234567"
 *   "+44 20 7946 0958"  -> "+442079460958"
 * Returns null when it cannot be a phone number.
 */
export function toE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (digits.startsWith('+')) {
    const rest = digits.slice(1).replace(/\D/g, '');
    return /^[1-9]\d{7,14}$/.test(rest) ? `+${rest}` : null;
  }
  digits = digits.replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  if (/^27\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}
