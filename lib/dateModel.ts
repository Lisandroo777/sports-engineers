/**
 * Centralized date/slate model for Research Lab + AI Finder.
 * Every date-aware request in the app should go through this module instead of
 * calling `new Date()` directly, so "today" is computed exactly once, consistently.
 */

export type SlateDate = string; // YYYY-MM-DD
export const SPORTS_TIME_ZONE = 'America/New_York';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidSlateDate(value: string | null | undefined): value is SlateDate {
  if (!value || !DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function toSlateDate(date: Date): SlateDate {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SPORTS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

/** Sports "today" in the application's Eastern calendar. */
export function todaySlateDate(): SlateDate {
  return toSlateDate(new Date());
}

export function tomorrowSlateDate(): SlateDate {
  return addDaysToSlateDate(todaySlateDate(), 1);
}

export function addDaysToSlateDate(date: SlateDate, days: number): SlateDate {
  const [y, m, d] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Resolves an untrusted (e.g. URL) date param to a valid slate date, defaulting to today. */
export function resolveSlateDate(value: string | null | undefined): SlateDate {
  return isValidSlateDate(value) ? value : todaySlateDate();
}

export type NaturalDateIntent = 'today' | 'tonight' | 'tomorrow';

export function dateIntentFromText(value: string): NaturalDateIntent | null {
  const text = value.toLowerCase();
  if (/\btomorrow\b/.test(text)) return 'tomorrow';
  if (/\btonight\b/.test(text)) return 'tonight';
  if (/\btoday\b/.test(text)) return 'today';
  return null;
}

export function slateDateForIntent(intent: NaturalDateIntent): SlateDate {
  return intent === 'tomorrow' ? tomorrowSlateDate() : todaySlateDate();
}

export type DatePreset = 'today' | 'tomorrow';

export function presetForSlateDate(date: SlateDate): DatePreset | null {
  if (date === todaySlateDate()) return 'today';
  if (date === tomorrowSlateDate()) return 'tomorrow';
  return null;
}

export function slateDateForPreset(preset: DatePreset): SlateDate {
  return preset === 'tomorrow' ? tomorrowSlateDate() : todaySlateDate();
}

/** ESPN's scoreboard `dates` param wants YYYYMMDD (no dashes). */
export function toEspnDateParam(date: SlateDate): string {
  return date.replace(/-/g, '');
}

export function formatSlateDateLabel(date: SlateDate): string {
  const preset = presetForSlateDate(date);
  if (preset === 'today') return 'Today';
  if (preset === 'tomorrow') return 'Tomorrow';
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
