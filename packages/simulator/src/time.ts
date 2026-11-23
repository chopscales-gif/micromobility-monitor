// The simulated city keeps Salt Lake City time. A "service day" runs from
// 05:00 local to 05:00 the next morning, so late-night rides belong to the
// evening they started in.

export const TIME_ZONE = "America/Denver";
const SERVICE_DAY_START_HOUR = 5;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

export type LocalTime = { date: string; hour: number; minute: number; weekday: number };

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function localTime(ms: number): LocalTime {
  const parts: Record<string, string> = {};
  for (const p of partsFormat.formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday!),
  };
}

/** UTC offset of the city's clock at the given instant, in ms (negative in Utah). */
function offsetMs(ms: number): number {
  const parts: Record<string, string> = {};
  for (const p of partsFormat.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instant at which the service day `date` (YYYY-MM-DD) begins. */
export function serviceDayStart(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d, SERVICE_DAY_START_HOUR);
  return naive - offsetMs(naive);
}

/** Service day (YYYY-MM-DD) that the instant falls in. */
export function serviceDayOf(ms: number): string {
  return localTime(ms - SERVICE_DAY_START_HOUR * HOUR_MS).date;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
