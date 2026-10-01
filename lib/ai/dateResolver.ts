import { addDaysToSlateDate, isValidSlateDate, todaySlateDate, type SlateDate } from '../dateModel';

export type DateResolutionType = 'relative' | 'weekday' | 'weekend' | 'calendar' | 'iso';

export interface ResolvedDate {
  rawDateText: string;
  resolvedDate: SlateDate;
  displayDate: string;
  resolutionType: DateResolutionType;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_PATTERN = '(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:rs?|rsday)?|fri(?:day)?|sat(?:urday)?)';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_PATTERN = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

function weekdayOf(date: SlateDate): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function weekdayIndex(token: string): number {
  return WEEKDAYS.findIndex((day) => day.startsWith(token.slice(0, 3)));
}

export function formatDisplayDate(date: SlateDate): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function build(rawDateText: string, resolvedDate: SlateDate, resolutionType: DateResolutionType): ResolvedDate {
  return { rawDateText, resolvedDate, displayDate: formatDisplayDate(resolvedDate), resolutionType };
}

/** Upcoming occurrence of a weekday; today counts as the upcoming one. */
function upcomingWeekday(today: SlateDate, target: number): SlateDate {
  return addDaysToSlateDate(today, (target - weekdayOf(today) + 7) % 7);
}

/** Month/day with no year: this year unless that date already passed, then next year. */
function calendarDate(today: SlateDate, month: number, day: number, year?: number): SlateDate | null {
  const thisYear = Number(today.slice(0, 4));
  const fullYear = year == null ? thisYear : year < 100 ? 2000 + year : year;
  const candidate = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isValidSlateDate(candidate)) return null;
  if (year == null && candidate < today) {
    const next = `${thisYear + 1}-${candidate.slice(5)}`;
    return isValidSlateDate(next) ? next : null;
  }
  return candidate;
}

/**
 * Deterministically finds and resolves the date expression in a request, relative to the
 * application's sports calendar. Returns null when the text contains no date language.
 */
export function resolveDateFromText(text: string, today: SlateDate = todaySlateDate()): ResolvedDate | null {
  const q = text.toLowerCase();

  const iso = q.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isValidSlateDate(iso[1])) return build(iso[1], iso[1], 'iso');

  const numeric = q.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const date = calendarDate(today, Number(numeric[1]), Number(numeric[2]), numeric[3] ? Number(numeric[3]) : undefined);
    if (date) return build(numeric[0], date, 'calendar');
  }

  const named = q.match(new RegExp(`\\b${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`));
  if (named) {
    const month = MONTHS.indexOf(named[1].slice(0, 3)) + 1;
    const date = calendarDate(today, month, Number(named[2]), named[3] ? Number(named[3]) : undefined);
    if (date) return build(named[0], date, 'calendar');
  }

  const tomorrow = q.match(/\btomorrow(?:\s+night)?\b/);
  if (tomorrow) return build(tomorrow[0], addDaysToSlateDate(today, 1), 'relative');
  const yesterday = q.match(/\byesterday\b/);
  if (yesterday) return build(yesterday[0], addDaysToSlateDate(today, -1), 'relative');
  const todayMatch = q.match(/\b(today|tonight)\b/);
  if (todayMatch) return build(todayMatch[0], today, 'relative');

  const weekend = q.match(/\b(this|next)?\s*weekend\b/);
  if (weekend) {
    const day = weekdayOf(today);
    // Mid-weekend "this weekend" is today; otherwise the upcoming Saturday.
    const thisWeekend = day === 0 || day === 6 ? today : upcomingWeekday(today, 6);
    const resolved = weekend[1] === 'next' ? upcomingWeekday(addDaysToSlateDate(thisWeekend, 1), 6) : thisWeekend;
    return build(weekend[0].trim(), resolved, 'weekend');
  }

  const weekday = q.match(new RegExp(`\\b(this|next|coming)?\\s*${WEEKDAY_PATTERN}\\b(?:\\s+night)?`));
  if (weekday) {
    const target = weekdayIndex(weekday[2]);
    const upcoming = upcomingWeekday(today, target);
    const resolved = weekday[1] === 'next' ? addDaysToSlateDate(upcoming, 7) : upcoming;
    return build(weekday[0].trim(), resolved, 'weekday');
  }

  return null;
}
