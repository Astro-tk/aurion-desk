/**
 * Display formats for Aurion Desk.
 *   Money: integer cents in, "R 1 234 567.89" out.
 *   Dates: "12 Mar 2026". Times are shown in Africa/Johannesburg (SAST, UTC+2, no daylight saving).
 */

export const TIME_ZONE = 'Africa/Johannesburg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** 123456789 -> "R 1 234 567.89". Accepts number or bigint cents. */
export function formatRand(cents: number | bigint | null | undefined, opts: { wholeRands?: boolean } = {}): string {
  if (cents === null || cents === undefined) return 'Not set';
  const big = typeof cents === 'bigint' ? cents : BigInt(Math.round(cents));
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const rands = groupThousands((abs / 100n).toString());
  const sign = negative ? '-' : '';
  if (opts.wholeRands) return `${sign}R ${rands}`;
  const c = (abs % 100n).toString().padStart(2, '0');
  return `${sign}R ${rands}.${c}`;
}

/** "1 234.50" or "R 1 234.50" -> 123450 cents. Returns null if it is not a money amount. */
export function parseRandToCents(input: string): number | null {
  const cleaned = input.replace(/^\s*R\s*/i, '').replace(/[\s ,]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return cleaned.startsWith('-') ? -cents : cents;
}

export function formatCount(n: number | null | undefined, maxDecimals = 1): string {
  if (n === null || n === undefined) return 'None';
  const fixed = Number.isInteger(n) ? n.toString() : n.toFixed(maxDecimals).replace(/\.?0+$/, '');
  const [whole, frac] = fixed.split('.');
  return groupThousands(whole ?? '0') + (frac ? `.${frac}` : '');
}

/** Calendar parts of an instant, in SAST. */
export function sastParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday as (typeof WEEKDAYS)[number]),
  };
}

/** A plain calendar date, "YYYY-MM-DD". */
export type IsoDate = string;

export function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Today's date in South Africa. */
export function todaySast(now: Date = new Date()): IsoDate {
  const p = sastParts(now);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing the date (weeks run Monday to Sunday). */
export function weekStart(date: IsoDate): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 Sunday
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** "2026-03-12" -> "12 Mar 2026". */
export function formatDate(value: IsoDate | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) {
    const p = sastParts(value);
    return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
  }
  if (!isIsoDate(value)) return value;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "Tue 1 Dec 2026". */
export function formatDateWithWeekday(value: IsoDate): string {
  return `${WEEKDAYS[weekdayOf(value)]} ${formatDate(value)}`;
}

/** Timestamp -> "12 Mar 2026, 14:05" in SAST. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const p = sastParts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Midnight SAST at the start of a date, as a UTC instant (for timestamptz range queries). */
export function sastDayStartUtc(date: IsoDate): string {
  return new Date(`${date}T00:00:00+02:00`).toISOString();
}

export const MONTH_ABBREVIATIONS = MONTHS;
export const WEEKDAY_ABBREVIATIONS = WEEKDAYS;
