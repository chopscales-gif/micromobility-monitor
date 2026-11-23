import { clock } from "@mm/core/clock";

// Everything on screen is shown in the city's own time, whatever the viewer's clock says.

const ZONE = "America/Denver";

const make = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, ...options });

const DATE_TIME = make({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const DATE = make({ month: "short", day: "numeric", year: "numeric" });
const TIME = make({ hour: "numeric", minute: "2-digit" });
const TIME_SECONDS = make({ hour: "numeric", minute: "2-digit", second: "2-digit" });
const WEEKDAY_TIME = make({ weekday: "short", hour: "numeric", minute: "2-digit" });

export const dateTime = (ms: number) => DATE_TIME.format(ms);
export const dateOnly = (ms: number) => DATE.format(ms);
export const timeOnly = (ms: number) => TIME.format(ms);
export const timeSeconds = (ms: number) => TIME_SECONDS.format(ms);
export const weekdayTime = (ms: number) => WEEKDAY_TIME.format(ms);

/** "2026-10-15" to "Oct 15, 2026", without the date slipping a day across time zones. */
export const plainDate = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(Date.parse(`${date}T00:00:00Z`));

export const count = (n: number) => n.toLocaleString("en-US");

export function duration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} days`;
}

export function percent(rate: number | null, digits = 1): string {
  if (rate === null) return "no data";
  const value = rate * 100;
  // Never round a shortfall up to a clean 100%.
  if (value < 100 && value > 100 - 0.5 / 10 ** digits) return `${(Math.floor(value * 10 ** digits) / 10 ** digits).toFixed(digits)}%`;
  return `${value.toFixed(value === 100 ? 0 : digits)}%`;
}

const DAY = make({ weekday: "short", month: "short", day: "numeric" });
const SHORT_DAY = make({ month: "short", day: "numeric" });
/** "Sat, Nov 14" */
export const dayLabel = (ms: number) => DAY.format(ms);
/** "Nov 14" */
export const shortDay = (ms: number) => SHORT_DAY.format(ms);

/** A length of time in the unit a person would say it in: "45 min", "14 h 20 min", "4.3 days". */
export function span(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")} min`;
  return `${(minutes / 1440).toFixed(1)} days`;
}

/** How long ago, coarsely: "3 hours ago", "12 days ago". */
export function ago(ms: number, now = clock()): string {
  const minutes = Math.max(0, Math.round((now - ms) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** "2026-11-23" to "Mon, Nov 23". */
export const plainDay = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(Date.parse(`${date}T00:00:00Z`));
/** "2026-11-09" to "Nov 9". */
export const plainShort = (date: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(Date.parse(`${date}T00:00:00Z`));
