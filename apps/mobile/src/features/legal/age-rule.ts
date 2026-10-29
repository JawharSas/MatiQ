/**
 * Minimum age for an account (COPPA). The database rule
 * (private.meets_minimum_age) decides; this copy lets the app stop a sign-up
 * before anything about the person is sent.
 *
 * Month precision: the 13th birthday may still be later in the current month,
 * so it only counts from the following month.
 */

export const MINIMUM_AGE = 13;

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface BirthMonth {
  year: number;
  month: number;
}

/** What the form holds: a chosen month (1-12) and the typed year. */
export interface BirthInput {
  month: number | null;
  year: string;
}

const monthIndex = (year: number, month: number) => year * 12 + month;

export function meetsMinimumAge({ year, month }: BirthMonth, today = new Date()): boolean {
  return monthIndex(today.getFullYear(), today.getMonth() + 1) - monthIndex(year, month) > MINIMUM_AGE * 12;
}

/** Checks the form fields; the message says what to fix (WCAG 3.3.1, 3.3.3). */
export function parseBirthMonth(input: BirthInput, today = new Date()): { ok: true; value: BirthMonth } | { ok: false; error: string } {
  if (input.month === null || input.month < 1 || input.month > 12) return { ok: false, error: 'Choose your birth month.' };
  const yearText = input.year.trim();
  if (!/^\d{4}$/.test(yearText)) return { ok: false, error: 'Enter your birth year as 4 digits, for example 1998.' };
  const year = Number(yearText);
  if (year < 1900 || monthIndex(year, input.month) > monthIndex(today.getFullYear(), today.getMonth() + 1)) {
    return { ok: false, error: 'Enter a real birth month and year.' };
  }
  return { ok: true, value: { year, month: input.month } };
}
