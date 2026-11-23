// The monthly report email, and the clearing of routes past their keeping time.
// The email is written to the outbox, never sent; its attachment is drawn from the
// records when someone opens it, so it cannot drift from what the console shows.

import { formatCents, lastClosedMonth, monthLabel, periodOf } from "@mm/core";
import type { Sql } from "@mm/db";

/** The seats the report is addressed to. The read-only seat is sent nothing; IT and operators do not receive it. */
export const REPORT_ROLES = ["program_manager", "analyst", "finance"] as const;

/** Where the report for a month can be opened. The address is checked against the reader's seat like any other page. */
export const reportHref = (year: number, month: number) => `/reports/${periodOf(year, month)}/pdf`;

const count = (n: number) => n.toLocaleString("en-US");

/**
 * Writes the report email for one finished month to each recipient who has not had it.
 * Safe to repeat: a person is never written the same month twice.
 */
export async function sendMonthlyReport(sql: Sql, year: number, month: number, at: number): Promise<number> {
  const period = periodOf(year, month);
  const href = reportHref(year, month);
  const rides = await sql`select o.name, count(t.trip_id)::int as n from operators o left join trips t on t.operator_id = o.id and t.billing_month = ${period} group by o.name order by n desc`;
  const total = rides.reduce((sum, r) => sum + r.n, 0);
  // With no rides on record there is nothing to report on.
  if (total === 0) return 0;
  const [fees] = await sql`select count(*)::int as n, coalesce(sum(total_cents), 0)::int as cents from invoices where year = ${year} and month = ${month}`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const people = await sql`select id, name, email from users u where role in ${sql(REPORT_ROLES)}
    and not exists (select 1 from outbox x where x.to_user_id = u.id and x.kind = 'report' and x.attachment_href = ${href}) order by name`;
  const label = monthLabel(year, month);
  for (const person of people) {
    const body = [
      `${String(person.name).split(" ")[0]},`,
      "",
      `The shared mobility report for ${label} is attached.`,
      "",
      `Rides in the month: ${count(total)}, about ${count(Math.round(total / days))} a day.`,
      ...rides.map((r) => `  ${r.name}: ${count(r.n)}`),
      ...(fees!.n > 0 ? ["", `Permit fees calculated: ${formatCents(fees!.cents)} across ${fees!.n} invoice${fees!.n === 1 ? "" : "s"}.`] : []),
      "",
      "The attachment has the rest: rides per day, how hard each fleet was worked, trip length, peak hours, equity zones, and the parts your seat covers of compliance and fees.",
      "",
      "This message is written on the first morning of each month by the scheduled reporting job.",
    ].join("\n");
    await sql`insert into outbox ${sql({ at: new Date(at), to_user_id: person.id, to_name: person.name, to_email: person.email, kind: "report", subject: `Shared mobility monthly report: ${label}`, body, attachment_name: `shared-mobility-report-${period}.pdf`, attachment_href: href })}`;
  }
  return people.length;
}

/**
 * Deletes the route of every ride that ended before `before`. The ride itself stays, with its
 * start and end hexagons, distance and duration, which is all the reports and the invoices use.
 */
export async function purgeRoutes(sql: Sql, before: number): Promise<number> {
  const result = await sql`update trips set route = null where route is not null and end_time < ${new Date(before)}`;
  return result.count;
}

/**
 * The part of the daily job that turns on the calendar: the report email for the month just finished,
 * and the deleting of routes past their keeping time. Run every day; on every day but the first of a
 * month the email has already been written, so only the routes change.
 */
export async function monthEnd(sql: Sql, now: number, retentionDays: number): Promise<{ period: string; written: number; purged: number; retentionDays: number }> {
  const { year, month } = lastClosedMonth(now);
  const written = await sendMonthlyReport(sql, year, month, now);
  const purged = await purgeRoutes(sql, now - retentionDays * 86_400_000);
  return { period: periodOf(year, month), written, purged, retentionDays };
}
