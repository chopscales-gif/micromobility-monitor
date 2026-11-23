// The city's clock. Fees are billed by calendar month in the city's own time
// zone, so "October" means October in Salt Lake City, not October in UTC.

export const CITY_NAME = "Salt Lake City";
export const CITY_TIME_ZONE = "America/Denver";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: CITY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function fields(ms: number): Record<string, string> {
  return Object.fromEntries(parts.formatToParts(ms).map((p) => [p.type, p.value]));
}

/** "2026-10-31" in the city. */
export function localDate(ms: number): string {
  const f = fields(ms);
  return `${f.year}-${f.month}-${f.day}`;
}

export function localHour(ms: number): number {
  return Number(fields(ms).hour);
}

/** "2026-10": the month a trip is billed in. */
export const billingMonth = (ms: number) => localDate(ms).slice(0, 7);

/** The instant a calendar day begins in the city. */
export function startOfLocalDay(date: string): number {
  // Midnight local is 6 or 7 hours after midnight UTC; try both sides of a clock change.
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  for (const offsetHours of [6, 7, 5, 8]) {
    const guess = utcMidnight + offsetHours * 3_600_000;
    const f = fields(guess);
    if (`${f.year}-${f.month}-${f.day}` === date && f.hour === "00" && f.minute === "00") return guess;
  }
  throw new Error(`Cannot find local midnight for ${date}`);
}

/** The half-open range of instants [start, end) that make up a calendar month in the city. */
export function monthRange(year: number, month: number): { start: number; end: number } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const next = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  return { start: startOfLocalDay(`${year}-${pad(month)}-01`), end: startOfLocalDay(`${next.y}-${pad(next.m)}-01`) };
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (year: number, month: number) => `${MONTH_NAMES[month - 1]} ${year}`;

/** A calendar date some days before or after another: addDays("2026-10-31", 1) is "2026-11-01". */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of the week a date falls in. Weekly rules run Monday to Sunday. */
export function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

/** The area the console covers. An uploaded zone outside it is almost always a coordinate mix-up. */
export const CITY_BOUNDS: [west: number, south: number, east: number, north: number] = [-112.0, 40.7, -111.77, 40.82];
