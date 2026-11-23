// The monthly email and the route purge, run against a real (scratch) database.
// Skipped, and reported as skipped, when no database server is running.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ROUTE_RETENTION_DAYS_DEFAULT } from "@mm/core";
import { addOperator, addTrips, addUser, empty, testDatabase, TEST_DAY as DAY } from "@mm/db/testing";
import { monthEnd, purgeRoutes, sendMonthlyReport } from "./monthly";

const db = await testDatabase("ingest");
const sql = db?.sql as NonNullable<typeof db>["sql"];
afterAll(async () => db?.close());

// 02:20 Mountain time on the first of November 2026, when the worker's daily job runs (09:20 UTC).
const NOV_1 = Date.UTC(2026, 10, 1, 9, 20);
const midOctober = Date.UTC(2026, 9, 15, 18);

describe.skipIf(!db)("monthly report email", () => {
  let operator: string;
  beforeEach(async () => {
    await empty(sql);
    operator = await addOperator(sql, "kestrel", "Kestrel");
    await addUser(sql, "Pat Manager", "program_manager");
    await addUser(sql, "Ana Analyst", "analyst");
    await addUser(sql, "Fin Finance", "finance");
    await addUser(sql, "Rae Reader", "read_only");
    await addUser(sql, "Ivy Admin", "admin");
    await addUser(sql, "Opal Operator", "operator", operator);
    await addTrips(sql, Array.from({ length: 62 }, () => ({ operatorId: operator, end: midOctober, month: "2026-10" })));
  });

  it("is written once to the manager, analyst and finance seats, and to nobody else", async () => {
    expect(await sendMonthlyReport(sql, 2026, 10, NOV_1)).toBe(3);
    const rows = await sql`select to_name, kind, subject, body, attachment_name, attachment_href, at from outbox order by to_name`;
    expect(rows.map((r) => r.to_name)).toEqual(["Ana Analyst", "Fin Finance", "Pat Manager"]);
    for (const r of rows) {
      expect(r.kind).toBe("report");
      expect(r.subject).toBe("Shared mobility monthly report: October 2026");
      expect(r.attachment_href).toBe("/reports/2026-10/pdf");
      expect(r.attachment_name).toBe("shared-mobility-report-2026-10.pdf");
      expect(r.body).toContain("Rides in the month: 62, about 2 a day.");
      expect(r.body).toContain("Kestrel: 62");
      expect(new Date(r.at).getTime()).toBe(NOV_1);
    }
  });

  it("is not written twice for the same month", async () => {
    await sendMonthlyReport(sql, 2026, 10, NOV_1);
    expect(await sendMonthlyReport(sql, 2026, 10, NOV_1 + DAY)).toBe(0);
    expect((await sql`select count(*)::int as n from outbox`)[0]!.n).toBe(3);
  });

  it("reaches someone who joined after the first run, without repeating the others", async () => {
    await sendMonthlyReport(sql, 2026, 10, NOV_1);
    await addUser(sql, "Ned Newanalyst", "analyst");
    expect(await sendMonthlyReport(sql, 2026, 10, NOV_1 + DAY)).toBe(1);
  });

  it("writes nothing for a month with no rides", async () => {
    expect(await sendMonthlyReport(sql, 2026, 9, NOV_1)).toBe(0);
    expect((await sql`select count(*)::int as n from outbox`)[0]!.n).toBe(0);
  });

  it("the daily job sends last month's report on the first of the month and only then", async () => {
    // The last evening of October in the city: October is not over, so the job looks at September, which has no rides.
    const before = await monthEnd(sql, Date.UTC(2026, 10, 1, 3), ROUTE_RETENTION_DAYS_DEFAULT);
    expect(before).toMatchObject({ period: "2026-09", written: 0 });
    const first = await monthEnd(sql, NOV_1, ROUTE_RETENTION_DAYS_DEFAULT);
    expect(first).toMatchObject({ period: "2026-10", written: 3 });
    const second = await monthEnd(sql, NOV_1 + DAY, ROUTE_RETENTION_DAYS_DEFAULT);
    expect(second).toMatchObject({ period: "2026-10", written: 0 });
    // New Year: the month before January is December of the year before.
    expect((await monthEnd(sql, Date.UTC(2027, 0, 1, 9, 20), ROUTE_RETENTION_DAYS_DEFAULT)).period).toBe("2026-12");
    expect((await sql`select count(*)::int as n from outbox`)[0]!.n).toBe(3);
  });
});

describe.skipIf(!db)("route purge", () => {
  const now = Date.UTC(2026, 10, 21, 12);
  let ids: string[];
  beforeEach(async () => {
    await empty(sql);
    const operator = await addOperator(sql, "kestrel", "Kestrel");
    ids = await addTrips(sql, [
      { operatorId: operator, end: now - 120 * DAY, month: "2026-07", route: true },
      { operatorId: operator, end: now - 90 * DAY - 60_000, month: "2026-08", route: true },
      { operatorId: operator, end: now - 90 * DAY + 60_000, month: "2026-08", route: true },
      { operatorId: operator, end: now - DAY, month: "2026-11", route: true },
      { operatorId: operator, end: now - 200 * DAY, month: "2026-05" },
    ]);
  });
  const routes = async () => (await sql`select trip_id, route is not null as kept from trips`).reduce<Record<string, boolean>>((all, r) => ({ ...all, [r.trip_id]: r.kept }), {});

  it("deletes the route of every ride past the keeping time and of no other", async () => {
    const before = [...(await sql`select trip_id, start_h3, end_h3, distance_m, duration_s, start_time, end_time, billing_month, start_lat, end_lng from trips order by trip_id`)];
    expect(await purgeRoutes(sql, now - 90 * DAY)).toBe(2);
    expect(await routes()).toEqual({ [ids[0]!]: false, [ids[1]!]: false, [ids[2]!]: true, [ids[3]!]: true, [ids[4]!]: false });
    // The ride itself stays exactly as it was: only the path is gone.
    expect([...(await sql`select trip_id, start_h3, end_h3, distance_m, duration_s, start_time, end_time, billing_month, start_lat, end_lng from trips order by trip_id`)]).toEqual(before);
  });

  it("finds nothing left to delete when run again", async () => {
    await purgeRoutes(sql, now - 90 * DAY);
    expect(await purgeRoutes(sql, now - 90 * DAY)).toBe(0);
  });

  it("follows the configured keeping time, through the daily job", async () => {
    expect((await monthEnd(sql, now, 365)).purged).toBe(0);
    expect((await monthEnd(sql, now, 90)).purged).toBe(2);
    expect((await monthEnd(sql, now, 1)).purged).toBe(1);
    expect(Object.values(await routes()).some(Boolean)).toBe(true);
    expect((await monthEnd(sql, now + 2 * DAY, 1)).purged).toBe(1);
    expect(Object.values(await routes()).some(Boolean)).toBe(false);
  });
});
