// The demonstration's reset, run against a real (scratch) database: everything a visitor can
// change through the console is changed, and the reset has to put all of it back.
// Skipped, and reported as skipped, when no database server is running.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RULES } from "@mm/core";
import { addOperator, addTrips, empty, testDatabase } from "@mm/db/testing";
import { adoptRules, issueOpeningInvoices, people, resetDemo } from "./demo-state";
import { generateInvoice } from "./invoices";

const db = await testDatabase("demo_state");
const sql = db?.sql as NonNullable<typeof db>["sql"];
afterAll(async () => db?.close());

const midOctober = Date.UTC(2026, 9, 15, 18);
const NOW = Date.UTC(2026, 10, 20, 18);
const square = (lng: number) => JSON.stringify({ type: "MultiPolygon", coordinates: [[[[lng, 40.76], [lng + 0.01, 40.76], [lng + 0.01, 40.77], [lng, 40.77], [lng, 40.76]]]] });
const addZone = (slug: string, source: string) => sql`insert into zones (slug, name, type, geom, source) values (${slug}, ${slug}, 'no_parking', st_setsrid(st_geomfromgeojson(${square(-111.9)}), 4326), ${source}) returning id`;

/** The parts of the demonstration's state a visitor can reach, read in one go. */
async function state() {
  const [zones, rules, schedules, invoices, audit] = await Promise.all([
    sql`select slug, active, retired_at, retired_by from zones order by slug`,
    sql`select kind, enabled, params, updated_by from rules order by kind`,
    sql`select effective_from::text as effective_from, per_ride_cents from fee_schedules order by effective_from`,
    sql`select number, status, issued_by, issue_note, total_cents, generated_at from invoices order by number`,
    sql`select count(*)::int as n from audit_log`,
  ]);
  return { zones: [...zones], rules: [...rules], schedules: [...schedules], invoices: [...invoices], audit: audit[0]!.n };
}

describe.skipIf(!db)("resetting the demonstration", () => {
  beforeEach(async () => {
    await empty(sql);
    const ids: Record<string, string> = {};
    for (const [slug, name] of [["kestrel", "Kestrel Mobility"], ["pronghorn", "Pronghorn Rides"], ["saltgrass", "Saltgrass Bikeshare"]] as const) {
      ids[slug] = await addOperator(sql, slug, name);
      await sql`insert into permits (operator_id, devices, start_date, note) values (${ids[slug]}, 100, '2026-01-01', 'Annual permit')`;
      await addTrips(sql, Array.from({ length: 40 }, () => ({ operatorId: ids[slug]!, end: midOctober, month: "2026-10" })));
    }
    // Kestrel's report agrees with the city's count; Pronghorn's is far off; Saltgrass has not filed.
    for (const [slug, reported] of [["kestrel", 40], ["pronghorn", 90]] as const) {
      await sql`insert into operator_reports (operator_id, month, vehicle_type, special_group, trip_count, rider_count, fetched_at) values (${ids[slug]!}, '2026-10', 'scooter', 'all_riders', ${reported}, 30, ${new Date(NOW)})`;
    }
    await sql`insert into fee_schedules (effective_from, per_device_annual_cents, per_ride_cents, min_billable_trip_seconds, exempt_equity_zone_trips, discrepancy_tolerance_pct, discrepancy_tolerance_trips, note, created_by, created_at)
      values ('2026-01-01', 3500, 20, 60, true, 1, 25, 'Adopted with the permit terms.', 'Marisol Vega', '2025-12-09 21:15:00+00')`;
    await addZone("library-square", "seed");
    await addZone("temple-square", "seed");
    await people(sql);
    await adoptRules(sql);
    for (const slug of Object.keys(ids)) await generateInvoice(sql, { id: ids[slug]!, slug }, 2026, 10, Date.UTC(2026, 10, 1, 9, 20));
    await issueOpeningInvoices(sql, NOW);
  });

  it("starts with Kestrel's invoice issued by finance and the others in draft", async () => {
    const { invoices } = await state();
    expect(invoices.map((i) => [i.number, i.status, i.issued_by])).toEqual([
      ["MM-2026-10-KES", "issued", "Priya Raman"],
      ["MM-2026-10-PRO", "draft", null],
      ["MM-2026-10-SAL", "draft", null],
    ]);
  });

  it("puts back zones, rules, fee schedules, invoices and the audit log after a visitor has changed each", async () => {
    const before = await state();

    const [drawn] = await addZone("visitor-drew-this", "drawn");
    const [trip] = await sql`select trip_id, operator_id, device_id from trips limit 1`;
    await sql`insert into zone_passes (trip_id, zone_id, operator_id, device_id, entered_at, limit_kph, speeds) values (${trip!.trip_id}, ${drawn!.id}, ${trip!.operator_id}, ${trip!.device_id}, ${new Date(midOctober)}, 12, '{90,140}')`;
    await sql`update zones set retired_at = now(), retired_by = 'A visitor', active = false where slug = 'temple-square'`;
    await sql`update rules set enabled = false, params = ${sql.json({ limitHours: 1 })}, updated_by = 'A visitor' where kind = 'parking_dwell'`;
    await sql`insert into fee_schedules (effective_from, per_device_annual_cents, per_ride_cents, min_billable_trip_seconds, exempt_equity_zone_trips, discrepancy_tolerance_pct, discrepancy_tolerance_trips, note, created_by)
      values ('2026-12-01', 9900, 95, 60, false, 1, 25, 'A visitor tried the form.', 'A visitor')`;
    await sql`update invoices set status = 'issued', issued_at = now(), issued_by = 'A visitor', issue_note = 'Issued anyway.' where number = 'MM-2026-10-PRO'`;
    await sql`insert into audit_log (user_name, role, action, resource) values ('A visitor', 'finance', 'change', 'invoice')`;
    expect(await state()).not.toEqual(before);

    expect(await resetDemo(sql, NOW)).toBe(true);
    expect(await state()).toEqual({ ...before, audit: 0 });
    expect((await sql`select count(*)::int as n from zone_passes`)[0]!.n).toBe(0);
    const [dwell] = await sql`select enabled, params from rules where kind = 'parking_dwell'`;
    expect(dwell).toMatchObject({ enabled: true, params: RULES.parking_dwell.defaults });
  });

  it("does not run twice at once", async () => {
    const results = await Promise.all([resetDemo(sql, NOW), resetDemo(sql, NOW)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await resetDemo(sql, NOW)).toBe(true);
  });
});
