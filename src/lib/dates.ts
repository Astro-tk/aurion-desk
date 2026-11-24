import { isIsoDate, MONTH_ABBREVIATIONS, type IsoDate } from './format';

/**
 * Reads the date formats people actually type or export:
 *   2026-12-01, 01/12/2026 (day first, South African), 1 Dec 2026, 1 December 2026, Tue 1 Dec 2026.
 * Returns null for anything ambiguous or invalid. No year means invalid (the tracker always has one).
 */
export function parseFlexibleDate(input: string): IsoDate | null {
  const s = input.trim();
  if (!s) return null;
  if (isIsoDate(s)) return s;

  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return build(Number(m[3]), Number(m[2]), Number(m[1]));

  m = s.match(/^(?:[A-Za-z]{3,9},?\s+)?(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) {
    const month = monthIndex(m[2]!);
    return month ? build(Number(m[3]), month, Number(m[1])) : null;
  }
  return null;
}

export function monthIndex(name: string): number | null {
  const i = MONTH_ABBREVIATIONS.findIndex((abbr) => name.slice(0, 3).toLowerCase() === abbr.toLowerCase());
  return i >= 0 ? i + 1 : null;
}

function build(y: number, mo: number, d: number): IsoDate | null {
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}
