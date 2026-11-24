import { describe, expect, it } from 'vitest';
import {
  addDays,
  formatDate,
  formatDateTime,
  formatRand,
  parseRandToCents,
  todaySast,
  weekStart,
} from '@/lib/format';
import { toE164 } from '@/lib/phone';

describe('money', () => {
  it('shows integer cents as R 1 234 567.89', () => {
    expect(formatRand(123456789)).toBe('R 1 234 567.89');
    expect(formatRand(350000)).toBe('R 3 500.00');
    expect(formatRand(5)).toBe('R 0.05');
    expect(formatRand(-120050)).toBe('-R 1 200.50');
    expect(formatRand(4500000, { wholeRands: true })).toBe('R 45 000');
    expect(formatRand(null)).toBe('Not set');
  });
  it('parses typed amounts back to cents', () => {
    expect(parseRandToCents('R 1 234.5')).toBe(123450);
    expect(parseRandToCents('3500')).toBe(350000);
    expect(parseRandToCents('12,000.00')).toBe(1200000);
    expect(parseRandToCents('abc')).toBeNull();
  });
});

describe('dates and SAST', () => {
  it('shows dates as 12 Mar 2026', () => {
    expect(formatDate('2026-03-12')).toBe('12 Mar 2026');
  });
  it('shows UTC timestamps in SAST', () => {
    expect(formatDateTime('2026-12-01T16:00:00Z')).toBe('1 Dec 2026, 18:00');
    expect(todaySast(new Date('2026-11-30T22:30:00Z'))).toBe('2026-12-01');
  });
  it('weeks start on Monday', () => {
    expect(weekStart('2026-12-06')).toBe('2026-11-30'); // Sunday
    expect(weekStart('2026-12-01')).toBe('2026-11-30'); // Tuesday
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('phones', () => {
  it('normalises South African numbers to E.164', () => {
    expect(toE164('082 123 4567')).toBe('+27821234567');
    expect(toE164('+27 82 123 4567')).toBe('+27821234567');
    expect(toE164('0027821234567')).toBe('+27821234567');
    expect(toE164('12')).toBeNull();
  });
});
