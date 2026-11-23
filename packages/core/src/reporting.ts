// The arithmetic behind the monthly report, kept apart from the queries that feed it.

import { addDays, localDate, monthRange, weekStart } from "./city";

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10" to its year and month, or null if it is not a month. */
export function parsePeriod(period: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
}

export const periodOf = (year: number, month: number) => `${year}-${pad(month)}`;

/** The month before the one `now` falls in: the newest month that is over. */
export function lastClosedMonth(now: number): { year: number; month: number } {
  const [year, month] = localDate(now).split("-").map(Number) as [number, number];
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** A month is closed once its last day has ended in the city. */
export const isClosed = (year: number, month: number, now: number) => monthRange(year, month).end <= now;

/** The days of a month that have begun, as calendar dates. */
export function daysIn(year: number, month: number, now: number): string[] {
  const { end } = monthRange(year, month);
  const last = localDate(Math.min(end, now + 1) - 1);
  const days: string[] = [];
  for (let day = `${year}-${pad(month)}-01`; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The rule weeks (Monday to Sunday) that begin in a month and have begun by `now`. A week belongs to the month its Monday falls in. */
export function weeksIn(year: number, month: number, now: number): string[] {
  const days = daysIn(year, month, now);
  return days.filter((day) => weekStart(day) === day);
}

/** Rides per vehicle per day: the usual measure of how hard a fleet is worked. Null when there is nothing to divide by. */
export function utilization(trips: number, vehicles: number, days: number): number | null {
  return vehicles > 0 && days > 0 ? trips / vehicles / days : null;
}

/**
 * The compliance rate: of every rule in force in every week, the share in which no breach was confirmed.
 * Null when no week has begun.
 */
export function complianceRate(ruleWeeks: number, breached: number): number | null {
  return ruleWeeks > 0 ? Math.max(0, ruleWeeks - breached) / ruleWeeks : null;
}

/** The value below which half of an ordered list falls. */
export function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
