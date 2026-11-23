// The public figures and the staff report, worked out from a real (scratch) database with a small,
// awkward month in it: an operator with a handful of rides, a quiet day, a quiet hour, a quiet corner
// of town and a few rides in an equity zone. Whatever the public side publishes about that month must
// not let a group of fewer than ten rides be read off, or worked out by subtraction.
// Skipped, and reported as skipped, when no database server is running.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@mm/core/access";
import { K_ANONYMITY_MIN } from "@mm/core/privacy";
import { addOperator, addTrips, addUser, addVehicles, testDatabase, type TestTrip } from "@mm/db/testing";
import { latLngToCell } from "h3-js";

const db = await testDatabase("web");
const sql = db?.sql as NonNullable<typeof db>["sql"];
// The console's own connection reads this when it is first imported, below.
if (db) process.env.DATABASE_URL = db.url;
const { openData, publicMonths } = db ? await import("./open-data") : ({} as typeof import("./open-data"));
const { monthlyReport } = db ? await import("./reports") : ({} as typeof import("./reports"));
const { Refused } = db ? await import("./guard") : ({} as typeof import("./guard"));
const { fileBody, FILES, NOTICE } = await import("@/lib/open-data");
afterAll(async () => {
  if (db) await (await import("./db")).sql.end();
  await db?.close();
});

const NOW = Date.UTC(2026, 10, 21, 18);
/** A moment on a day of October 2026 in the city, late morning (Mountain Daylight Time is six hours behind UTC). */
const october = (day: number, utcHour = 18) => Date.UTC(2026, 9, day, utcHour, 5);
// Three parts of town far enough apart to fall in three different public hexagons.
const [CENTRE, CORNER, EDGE] = [0, 1, 2].map((i) => latLngToCell(40.76 + i * 0.03, -111.89, 9)) as [string, string, string];

const ids: { trips: string[]; devices: string[] } = { trips: [], devices: [] };
const actors = {} as Record<"manager" | "analyst" | "finance" | "reader" | "admin" | "operator", Actor>;

beforeAll(async () => {
  if (!db) return;
  const kestrel = await addOperator(sql, "kestrel", "Kestrel");
  const pronghorn = await addOperator(sql, "pronghorn", "Pronghorn");
  const sego = await addOperator(sql, "sego", "Sego");
  const seen = { first: october(1), last: october(31) };
  ids.devices.push(...(await addVehicles(sql, kestrel, "scooter", 20, seen)), ...(await addVehicles(sql, kestrel, "bicycle", 10, seen)), ...(await addVehicles(sql, pronghorn, "scooter", 12, seen)), ...(await addVehicles(sql, sego, "scooter", 3, seen)));

  // 84 rides: Kestrel 40 scooter, 12 bike and 3 on unlisted vehicles; Pronghorn 25; Sego 4.
  const rides: TestTrip[] = [
    ...Array.from({ length: 40 }, () => ({ operatorId: kestrel, type: "scooter" })),
    ...Array.from({ length: 12 }, () => ({ operatorId: kestrel, type: "bicycle" })),
    ...Array.from({ length: 3 }, () => ({ operatorId: kestrel, type: "unknown" })),
    ...Array.from({ length: 25 }, () => ({ operatorId: pronghorn, type: "scooter" })),
    ...Array.from({ length: 4 }, () => ({ operatorId: sego, type: "scooter" })),
  ].map((ride, i) => ({
    ...ride,
    month: "2026-10",
    // Monday the 5th has 5 rides, Tuesday the 6th has 11, Saturday the 10th the other 68; three of those in the small hours.
    end: i < 5 ? october(5) : i < 16 ? october(6) : i >= 20 && i < 23 ? october(10, 8) : october(10),
    // 4 rides began in one corner and 12 at the edge; the rest in the centre. All ended in the centre.
    startH3: i >= 30 && i < 34 ? CORNER : i >= 40 && i < 52 ? EDGE : CENTRE,
    endH3: CENTRE,
    equity: i >= 60 && i < 66,
    distanceM: 2040,
    durationS: 610,
    route: true,
  }));
  ids.trips.push(...(await addTrips(sql, rides)));
  // A month too small to publish at all, and one still running.
  await addTrips(sql, Array.from({ length: 9 }, () => ({ operatorId: kestrel, month: "2026-09", end: Date.UTC(2026, 8, 15, 18) })));
  await addTrips(sql, Array.from({ length: 50 }, () => ({ operatorId: kestrel, month: "2026-11", end: Date.UTC(2026, 10, 10, 18) })));

  actors.manager = (await addUser(sql, "Pat Manager", "program_manager")) as Actor;
  actors.analyst = (await addUser(sql, "Ana Analyst", "analyst")) as Actor;
  actors.finance = (await addUser(sql, "Fin Finance", "finance")) as Actor;
  actors.reader = (await addUser(sql, "Rae Reader", "read_only")) as Actor;
  actors.admin = (await addUser(sql, "Ivy Admin", "admin")) as Actor;
  actors.operator = (await addUser(sql, "Opal Operator", "operator", kestrel)) as Actor;

  // Two rules in force. Pronghorn has one confirmed breach; Kestrel's finding is held; Sego's notice was withdrawn.
  const longAgo = new Date(Date.UTC(2026, 0, 1));
  for (const kind of ["fleet_cap", "parking_dwell"]) await sql`insert into rules ${sql({ kind, params: sql.json({}), effective_from: longAgo, updated_by: "test" })}`;
  const finding = async (operatorId: string, standing: string, outcome: string | null, noticed: boolean) => {
    const [made] = await sql`insert into cases ${sql({ rule_kind: "fleet_cap", operator_id: operatorId, week_start: "2026-10-05", opened_at: new Date(october(6)), notified_at: noticed ? new Date(october(7)) : null, outcome })} returning id`;
    await sql`insert into violations ${sql({ rule_kind: "fleet_cap", operator_id: operatorId, period_start: new Date(october(6)), measured: 12, threshold: 10, rule_params: sql.json({}), evidence: sql.json({}), detected_at: new Date(october(6)), last_evaluated_at: new Date(october(6)), case_id: made!.id, standing })}`;
  };
  await finding(pronghorn, "counted", null, true);
  await finding(kestrel, "held", null, false);
  await finding(sego, "counted", "withdrawn", true);

  const [invoice] = await sql`insert into invoices ${sql({ number: "T-2026-10-KES", operator_id: kestrel, year: 2026, month: 10, status: "issued", schedule: sql.json({ perRideCents: 20 }), total_cents: 12_345, device_days: 930, observed_trips: 55, billable_trips: 49, exempt_equity_trips: 6, exempt_short_trips: 0, rejected_trip_records: 0, generated_at: new Date(NOW) })} returning id`;
  await sql`insert into invoice_lines ${sql([
    { invoice_id: invoice!.id, position: 1, kind: "device_permit", description: "Permits", quantity: 30, unit_label: "devices", amount_cents: 11_365 },
    { invoice_id: invoice!.id, position: 2, kind: "rides", description: "Rides", quantity: 49, unit_label: "rides", amount_cents: 980 },
  ])}`;
  await sql`insert into invoices ${sql({ number: "T-2026-10-PRO", operator_id: pronghorn, year: 2026, month: 10, status: "draft", schedule: sql.json({ perRideCents: 20 }), total_cents: 5_000, device_days: 372, observed_trips: 25, billable_trips: 25, exempt_equity_trips: 0, exempt_short_trips: 0, rejected_trip_records: 0, generated_at: new Date(NOW) })}`;
});

/** True when a count says something about a group of one to nine rides. */
const small = (n: number) => n > 0 && n < K_ANONYMITY_MIN;
/** What is left of a published total once every published part is taken away: it must be nothing, or a group of ten or more. */
const remainder = (total: number, parts: (number | null)[]) => total - parts.reduce<number>((sum, n) => sum + (n ?? 0), 0);

describe.skipIf(!db)("public open data", () => {
  const data = async () => (await openData("2026-10", NOW))!;

  it("lists only finished months with enough rides to publish", async () => {
    expect(await publicMonths(NOW)).toEqual([{ period: "2026-10", label: "October 2026" }]);
    expect(await openData("2026-11", NOW)).toBeNull();
    expect(await openData("2026-09", NOW)).toBeNull();
    expect(await openData("2026-08", NOW)).toBeNull();
    expect(await openData("nonsense", NOW)).toBeNull();
  });

  it("gives the month's totals from the rides on record", async () => {
    const d = await data();
    expect(d.trips).toBe(84);
    expect(d.vehicles).toBe(45);
    expect(d.perVehicleDay).toBeCloseTo(84 / 45 / 31, 10);
    expect(d.medianDistanceKm).toBe(2);
    expect(d.medianDurationMin).toBe(10);
    expect(d.daily).toHaveLength(31);
  });

  it("leaves out the small operator, and the next smallest so the total cannot give it away", async () => {
    const d = await data();
    expect(d.operators.map((o) => [o.slug, o.trips, o.vehicles])).toEqual([["kestrel", 55, 30]]);
    expect(d.operatorsWithheld).toBe(2);
    expect(d.types).toEqual(["scooter", "bicycle", "unknown"]);
    // 3 rides on unlisted vehicles are withheld, and the 12 bike rides with them: 55 less 40 would otherwise leave them plain.
    expect(d.operators[0]!.byType).toEqual([40, null, null]);
  });

  it("withholds the quiet day, the quiet hour, the quiet corner and the small equity share", async () => {
    const d = await data();
    const day = (date: string) => d.daily.find((x) => x.date === date)!.trips;
    expect([day("2026-10-05"), day("2026-10-06"), day("2026-10-10"), day("2026-10-20")]).toEqual([null, null, 68, 0]);
    expect(d.hours[11]).toEqual({ hour: 11, weekday: 16, weekend: null });
    expect(d.hours[1]).toEqual({ hour: 1, weekday: 0, weekend: null });
    expect(d.starts.cells.map((c) => c.trips)).toEqual([68]);
    expect(d.starts).toMatchObject({ withheldCells: 2, withheldTrips: 16 });
    expect(d.ends.cells.map((c) => c.trips)).toEqual([84]);
    expect(d.equityShare).toBeNull();
  });

  it("publishes no count of one to nine rides, and none that subtraction would reveal", async () => {
    const d = await data();
    const breakdowns: [name: string, total: number, parts: (number | null)[]][] = [
      ["days", d.trips, d.daily.map((x) => x.trips)],
      ["operators", d.trips, d.operators.map((o) => o.trips)],
      ["vehicles", d.vehicles, d.operators.map((o) => o.vehicles)],
      ...d.operators.map((o): [string, number, (number | null)[]] => [`types of ${o.slug}`, o.trips, o.byType]),
      ["hours", d.trips, d.hours.flatMap((h) => [h.weekday, h.weekend])],
      ["starts", d.trips, d.starts.cells.map((c) => c.trips)],
      ["ends", d.trips, d.ends.cells.map((c) => c.trips)],
    ];
    for (const [name, total, parts] of breakdowns) {
      expect(parts.filter((n) => n !== null && small(n)), `${name}: a small count is published`).toEqual([]);
      expect(small(remainder(total, parts)), `${name}: ${remainder(total, parts)} rides can be worked out by subtraction`).toBe(false);
    }
  });

  it("names places only as coarse hexagons with centres rounded to three decimal places", async () => {
    const d = await data();
    for (const cell of [...d.starts.cells, ...d.ends.cells]) {
      expect(cell.h3).toMatch(/^88[0-9a-f]+$/);
      expect(cell.h3).not.toBe(CENTRE);
      for (const value of [cell.lat, cell.lng]) expect(String(value)).toMatch(/^-?\d+(\.\d{1,3})?$/);
    }
  });

  it("puts nothing in any download that is not in the published figures", async () => {
    const d = await data();
    const everything = JSON.stringify(d) + FILES.map((f) => fileBody(d, f.file)).join("\n");
    // No ride, no vehicle, no exact place a ride began or ended.
    for (const id of [...ids.trips, ...ids.devices]) expect(everything.includes(id)).toBe(false);
    for (const exact of ["40.76123", "111.89123", "40.76523", "111.88123", CENTRE, CORNER, EDGE]) expect(everything.includes(exact)).toBe(false);
    for (const hidden of ["Pronghorn", "Sego", "pronghorn", "sego"]) expect(everything.includes(hidden)).toBe(false);

    for (const { file } of FILES.filter((f) => f.file.endsWith(".csv"))) {
      const [first, second, header, ...rows] = fileBody(d, file).trimEnd().split("\r\n") as [string, string, string, ...string[]];
      expect(first).toBe(`# ${NOTICE}`);
      expect(second.startsWith("# Counts under 10 rides are withheld")).toBe(true);
      const columns = header.split(",");
      const counted = columns.flatMap((name, i) => (/^rides|_rides$|^vehicles$/.test(name) ? [i] : []));
      expect(counted.length).toBeGreaterThan(0);
      for (const row of rows) for (const i of counted) expect(row.split(",")[i] === "" || !small(Number(row.split(",")[i])), `${file}: ${row}`).toBe(true);
    }
    const geo = JSON.parse(fileBody(d, "ride-areas.geojson"));
    expect(geo.notice).toBe(NOTICE);
    expect(geo.features.map((f: any) => f.properties.rides).sort()).toEqual([68, 84]);
    for (const f of geo.features) for (const value of f.geometry.coordinates) expect(String(value)).toMatch(/^-?\d+(\.\d{1,3})?$/);
  });

  it("writes nothing to the audit log, having no seat to record", async () => {
    await data();
    expect((await sql`select count(*)::int as n from audit_log where resource <> 'monthly_report'`)[0]!.n).toBe(0);
  });
});

describe.skipIf(!db)("staff monthly report", () => {
  it("counts every ride once, by operator, by type and by day", async () => {
    const r = (await monthlyReport(actors.manager, "2026-10", "read", NOW))!;
    expect(r).toMatchObject({ period: "2026-10", label: "October 2026", closed: true, days: 31 });
    expect(r.city).toMatchObject({ trips: 84, vehicles: 45, medianDistanceM: 2040, medianDurationS: 610, equityTrips: 6 });
    expect(r.city.perVehicleDay).toBeCloseTo(84 / 45 / 31, 10);
    expect(r.operators.map((o) => [o.slug, o.trips, o.vehicles])).toEqual([["kestrel", 55, 30], ["pronghorn", 25, 12], ["sego", 4, 3]]);
    expect(r.operators[1]!.perVehicleDay).toBeCloseTo(25 / 12 / 31, 10);
    // Rides on vehicles no operator listed are their own line, so the lines add up to the total.
    expect(r.types.map((t) => [t.type, t.trips, t.vehicles])).toEqual([["scooter", 69, 35], ["bicycle", 12, 10], ["unknown", 3, 0]]);
    expect(r.types.reduce((sum, t) => sum + t.trips, 0)).toBe(r.city.trips);
    expect(r.daily).toHaveLength(31);
    expect(r.daily.reduce((sum, d) => sum + d.total, 0)).toBe(84);
    expect(r.daily.find((d) => d.date === "2026-10-06")).toEqual({ date: "2026-10-06", total: 11, byOperator: { kestrel: 11 } });
    expect(r.busiest).toMatchObject({ date: "2026-10-10", total: 68 });
    expect(r.distance.reduce((sum, b) => sum + b.trips, 0)).toBe(84);
    expect(r.distance.find((b) => b.label === "2 to 3 km")!.trips).toBe(84);
    expect(r.duration.find((b) => b.label === "10 to 15 min")!.trips).toBe(84);
  });

  it("averages each hour over the weekdays and the weekend days of the month", async () => {
    const r = (await monthlyReport(actors.manager, "2026-10", "read", NOW))!;
    // October 2026 has 22 weekdays and 9 weekend days.
    expect(r.hours[11]!.weekday).toBeCloseTo(16 / 22, 10);
    expect(r.hours[11]!.weekend).toBeCloseTo(65 / 9, 10);
    expect(r.hours[1]!.weekend).toBeCloseTo(3 / 9, 10);
    expect(r.peak!.weekend.hour).toBe(11);
  });

  it("counts a rule as broken in a week only for a counted finding on a case that was not withdrawn", async () => {
    const { compliance } = (await monthlyReport(actors.manager, "2026-10", "read", NOW))!;
    // Two rules, four weeks beginning in October, three operators.
    expect(compliance).toMatchObject({ weeks: ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"], ruleWeeks: 24, breached: 1 });
    expect(compliance!.rate).toBeCloseTo(23 / 24, 10);
    const row = (slug: string) => compliance!.operators.find((o) => o.slug === slug)!;
    expect(row("pronghorn")).toMatchObject({ ruleWeeks: 8, breached: 1, notices: 1, byRule: { fleet_cap: 1, parking_dwell: 0 } });
    expect(row("kestrel")).toMatchObject({ breached: 0, notices: 0, rate: 1 });
    expect(row("sego")).toMatchObject({ breached: 0, notices: 0, rate: 1 });
  });

  it("adds up the month's invoices and the fees waived for equity rides", async () => {
    const { revenue } = (await monthlyReport(actors.finance, "2026-10", "read", NOW))!;
    expect(revenue).toMatchObject({ totalCents: 17_345, issuedCents: 12_345, waivedCents: 120 });
    expect(revenue!.rows[0]).toMatchObject({ slug: "kestrel", number: "T-2026-10-KES", status: "issued", deviceCents: 11_365, rideCents: 980, totalCents: 12_345, billableTrips: 49, exemptEquityTrips: 6 });
  });

  it("shows each seat only its own sections", async () => {
    const section = async (actor: Actor) => {
      const r = (await monthlyReport(actor, "2026-10", "read", NOW))!;
      return { compliance: r.compliance !== null, revenue: r.revenue !== null };
    };
    expect(await section(actors.manager)).toEqual({ compliance: true, revenue: true });
    expect(await section(actors.analyst)).toEqual({ compliance: true, revenue: true });
    expect(await section(actors.finance)).toEqual({ compliance: false, revenue: true });
    expect(await section(actors.reader)).toEqual({ compliance: true, revenue: true });
  });

  it("refuses the administrator and the operator, refuses the read-only seat the PDF, and records each attempt", async () => {
    await sql`delete from audit_log`;
    await expect(monthlyReport(actors.admin, "2026-10", "read", NOW)).rejects.toBeInstanceOf(Refused);
    await expect(monthlyReport(actors.operator, "2026-10", "read", NOW)).rejects.toBeInstanceOf(Refused);
    await expect(monthlyReport(actors.reader, "2026-10", "export", NOW)).rejects.toBeInstanceOf(Refused);
    expect(await monthlyReport(actors.finance, "2026-10", "export", NOW)).not.toBeNull();
    const log = await sql`select user_name, action, resource, allowed, detail->>'month' as month from audit_log order by id`;
    expect(log.map((l) => [l.user_name, l.action, l.resource, l.allowed, l.month])).toEqual([
      ["Ivy Admin", "read", "monthly_report", false, "2026-10"],
      ["Opal Operator", "read", "monthly_report", false, "2026-10"],
      ["Rae Reader", "export", "monthly_report", false, "2026-10"],
      ["Fin Finance", "export", "monthly_report", true, "2026-10"],
    ]);
  });

  it("marks a month still running as unfinished and returns nothing for a month without rides", async () => {
    const running = (await monthlyReport(actors.manager, "2026-11", "read", NOW))!;
    expect(running.closed).toBe(false);
    expect(running.city.trips).toBe(50);
    expect(running.days).toBeGreaterThan(20);
    expect(running.days).toBeLessThan(21);
    expect(await monthlyReport(actors.manager, "2026-07", "read", NOW)).toBeNull();
    expect(await monthlyReport(actors.manager, "nonsense", "read", NOW)).toBeNull();
  });
});
