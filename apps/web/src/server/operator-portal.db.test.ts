// The operator portal, tried against a real (scratch) database holding two operators. One operator's
// seat asks for everything the console can serve, including the other operator's records by number.
// It must get its own and nothing else, the city's working material must stay with the city, and
// every attempt, allowed or not, must be in the audit log.
// Skipped, and reported as skipped, when no database server is running.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@mm/core/access";
import { addOperator, addUser, addVehicles, testDatabase } from "@mm/db/testing";
import { latLngToCell } from "h3-js";

const db = await testDatabase("portal");
const sql = db?.sql as NonNullable<typeof db>["sql"];
// The console's own connection reads this when it is first imported, below.
if (db) process.env.DATABASE_URL = db.url;
const load = async <T>(module: () => Promise<T>): Promise<T> => (db ? await module() : ({} as T));
const { standing } = await load(() => import("./standing"));
const { caseDetail, caseQueue, liveCases } = await load(() => import("./cases"));
const { violationDetail } = await load(() => import("./violations"));
const { invoiceDetail, invoiceList, invoiceTrips } = await load(() => import("./fees"));
const { dataHealth } = await load(() => import("./health"));
const { feedsNow, records } = await load(() => import("./home"));
const { liveMap } = await load(() => import("./map"));
const { Refused } = await load(() => import("./guard"));
afterAll(async () => {
  if (db) await (await import("./db")).sql.end();
  await db?.close();
});

/** Midday in the city on Saturday 21 November 2026. */
const NOW = Date.UTC(2026, 10, 21, 19);
const HOUR = 3_600_000;
const STAFF_NOTE = "GPS drift suspected; checking against the second feed";
const CLOSING_NOTE = "Closed after a site visit by the analyst";

const actors = {} as Record<"kestrel" | "pronghorn" | "analyst" | "finance", Actor>;
const op = {} as Record<"kestrel" | "pronghorn", string>;
/** Case and finding numbers, by a name that says what each is for. */
const cases = {} as Record<"warned" | "fined" | "unsent" | "withdrawn" | "old" | "theirs", number>;
const findings = {} as Record<"counted" | "held" | "unsent" | "theirs", number>;

const refusals = async (actor: Actor, resource: string) =>
  (await sql`select allowed, detail from audit_log where user_id = ${actor.userId} and resource = ${resource} and not allowed order by id`).map((r) => r.detail as Record<string, unknown> | null);

beforeAll(async () => {
  if (!db) return;
  op.kestrel = await addOperator(sql, "kestrel", "Kestrel");
  op.pronghorn = await addOperator(sql, "pronghorn", "Pronghorn");
  actors.kestrel = (await addUser(sql, "Opal Operator", "operator", op.kestrel)) as Actor;
  actors.pronghorn = (await addUser(sql, "Perry Operator", "operator", op.pronghorn)) as Actor;
  actors.analyst = (await addUser(sql, "Ana Analyst", "analyst")) as Actor;
  actors.finance = (await addUser(sql, "Fin Finance", "finance")) as Actor;

  const at = (iso: string) => new Date(`${iso}T18:00:00Z`);
  const addCase = async (operatorId: string, kind: string, week: string, c: { step?: number; status: string; outcome?: string; noticed: boolean }) => {
    const [row] = await sql`insert into cases ${sql({ rule_kind: kind, operator_id: operatorId, week_start: week, status: c.status, outcome: c.outcome ?? null, step: c.step ?? null, opened_at: at(week), notified_at: c.noticed ? at(week) : null })} returning id, number`;
    return { id: row!.id as string, number: Number(row!.number) };
  };
  const addFinding = async (operatorId: string, kind: string, caseId: string, week: string, standingNow: string, note: string | null = null) => {
    const [row] = await sql`insert into violations ${sql({ rule_kind: kind, operator_id: operatorId, period_start: at(week), subject: `${caseId}-${standingNow}`, measured: 80, threshold: 72, rule_params: sql.json({}), evidence: sql.json({}), detected_at: at(week), last_evaluated_at: at(week), case_id: caseId, standing: standingNow, standing_note: note })} returning number`;
    return Number(row!.number);
  };

  // Kestrel, parking dwell: a warning put right, then a fine still open with one finding counted and one the city is still checking.
  const warned = await addCase(op.kestrel, "parking_dwell", "2026-11-02", { step: 1, status: "resolved", outcome: "corrected", noticed: true });
  const fined = await addCase(op.kestrel, "parking_dwell", "2026-11-09", { step: 2, status: "notified", noticed: true });
  findings.counted = await addFinding(op.kestrel, "parking_dwell", fined.id, "2026-11-09", "counted");
  findings.held = await addFinding(op.kestrel, "parking_dwell", fined.id, "2026-11-10", "held", STAFF_NOTE);
  await sql`insert into case_events ${sql([
    { case_id: warned.id, at: at("2026-11-03"), actor_name: "Ana Analyst", kind: "notice", note: "Notice sent" },
    { case_id: warned.id, at: at("2026-11-06"), actor_name: "Ana Analyst", kind: "resolved", note: CLOSING_NOTE },
  ])}`;
  // Kestrel, fleet cap: one case the city has not sent, and one it sent and then withdrew.
  const unsent = await addCase(op.kestrel, "fleet_cap", "2026-11-16", { status: "open", noticed: false });
  findings.unsent = await addFinding(op.kestrel, "fleet_cap", unsent.id, "2026-11-16", "counted");
  const withdrawn = await addCase(op.kestrel, "fleet_cap", "2026-10-05", { step: 1, status: "resolved", outcome: "withdrawn", noticed: true });
  // Kestrel, rebalancing: a notice more than twelve months old.
  const old = await addCase(op.kestrel, "rebalancing_sla", "2025-10-06", { step: 1, status: "resolved", outcome: "corrected", noticed: true });
  // Pronghorn: three notices on one rule, so its next would refer the permit.
  for (const week of ["2026-09-07", "2026-09-14"]) await addCase(op.pronghorn, "slow_zone_speed", week, { step: 1, status: "resolved", outcome: "corrected", noticed: true });
  const theirs = await addCase(op.pronghorn, "slow_zone_speed", "2026-11-09", { step: 3, status: "notified", noticed: true });
  findings.theirs = await addFinding(op.pronghorn, "slow_zone_speed", theirs.id, "2026-11-09", "counted");
  Object.assign(cases, { warned: warned.number, fined: fined.number, unsent: unsent.number, withdrawn: withdrawn.number, old: old.number, theirs: theirs.number });

  // Permits: Kestrel has 10 devices in force and 5 that lapsed in June. Pronghorn has 3.
  await sql`insert into permits ${sql([
    { operator_id: op.kestrel, devices: 10, start_date: "2026-01-01", end_date: null },
    { operator_id: op.kestrel, devices: 5, start_date: "2026-01-01", end_date: "2026-06-30" },
    { operator_id: op.pronghorn, devices: 3, start_date: "2026-01-01", end_date: null },
  ])}`;

  // One equity zone, a small square. Kestrel has 12 vehicles: 10 available (4 of them in the zone, one
  // standing 50 hours and one 80), one on a ride and one taken off the street. Pronghorn has 5 available.
  await sql`insert into zones (slug, name, type, geom, effective_from) values ('west', 'West side', 'equity',
    st_multi(st_geomfromgeojson(${JSON.stringify({ type: "Polygon", coordinates: [[[-111.95, 40.75], [-111.93, 40.75], [-111.93, 40.77], [-111.95, 40.77], [-111.95, 40.75]]] })})), ${new Date(Date.UTC(2026, 0, 1))})`;
  const seen = { first: Date.UTC(2026, 0, 1), last: NOW };
  const park = (operatorId: string, deviceId: string, state: string, lng: number, hoursAgo: number) => ({
    device_id: deviceId, operator_id: operatorId, state, event_types: ["trip_end"], event_time: new Date(NOW - hoursAgo * HOUR), lng, lat: 40.76, h3: latLngToCell(40.76, lng, 9), battery: 80, updated_at: new Date(NOW - 60_000),
  });
  const k = await addVehicles(sql, op.kestrel, "scooter", 12, seen);
  const p = await addVehicles(sql, op.pronghorn, "scooter", 5, seen);
  await sql`insert into vehicle_status ${sql([
    ...k.slice(0, 4).map((id) => park(op.kestrel, id, "available", -111.94, 2)),
    ...k.slice(4, 8).map((id) => park(op.kestrel, id, "available", -111.89, 2)),
    park(op.kestrel, k[8]!, "available", -111.89, 50),
    park(op.kestrel, k[9]!, "available", -111.89, 80),
    park(op.kestrel, k[10]!, "on_trip", -111.89, 100),
    park(op.kestrel, k[11]!, "removed", -111.89, 100),
    ...p.map((id) => park(op.pronghorn, id, "available", -111.94, 90)),
  ])}`;
  await sql`insert into feed_polls ${sql([op.kestrel, op.pronghorn].map((id) => ({ operator_id: id, feed: "gbfs.vehicle_status", polled_at: new Date(), outcome: "ok", latency_ms: 120, record_count: 10 })))}`;

  const bill = (number: string, operatorId: string, status: string) => ({
    number, operator_id: operatorId, year: 2026, month: Number(number.slice(7, 9)), status, schedule: sql.json({ perRideCents: 20 }), total_cents: 5_000, device_days: 310, observed_trips: 25, billable_trips: 25,
    exempt_equity_trips: 0, exempt_short_trips: 0, rejected_trip_records: 0, generated_at: new Date(NOW),
  });
  await sql`insert into invoices ${sql([bill("T-2026-10-KES", op.kestrel, "issued"), bill("T-2026-11-KES", op.kestrel, "draft"), bill("T-2026-10-PRO", op.pronghorn, "issued")])}`;
});

describe.skipIf(!db)("an operator's standing", () => {
  it("is given to the operator for itself alone", async () => {
    const mine = await standing(actors.kestrel, NOW);
    expect(mine.map((s) => s.slug)).toEqual(["kestrel"]);
    expect((await standing(actors.pronghorn, NOW)).map((s) => s.slug)).toEqual(["pronghorn"]);
    expect((await standing(actors.analyst, NOW)).map((s) => s.slug)).toEqual(["kestrel", "pronghorn"]);
  });

  it("counts the notices sent in the last twelve months and names the next rung", async () => {
    const [mine] = await standing(actors.kestrel, NOW);
    const dwell = mine!.rules.find((r) => r.kind === "parking_dwell")!;
    expect(dwell).toMatchObject({ counted: 2, next: 3, easesOn: "2027-11-02" });
    expect(dwell.notices.map((n) => [n.number, n.step, n.counts])).toEqual([[cases.fined, 2, true], [cases.warned, 1, true]]);

    const [theirs] = await standing(actors.pronghorn, NOW);
    expect(theirs!.rules.find((r) => r.kind === "slow_zone_speed")).toMatchObject({ counted: 3, next: 4, easesOn: "2027-09-07" });
  });

  it("lists a withdrawn notice without counting it, and leaves out what was never sent or is too old", async () => {
    const [mine] = await standing(actors.kestrel, NOW);
    const cap = mine!.rules.find((r) => r.kind === "fleet_cap")!;
    expect(cap).toMatchObject({ counted: 0, next: 1, easesOn: null });
    expect(cap.notices.map((n) => [n.number, n.counts])).toEqual([[cases.withdrawn, false]]);
    expect(mine!.rules.find((r) => r.kind === "rebalancing_sla")).toMatchObject({ counted: 0, next: 1, notices: [] });
    // The same holds for city staff: this page is the record put to the operator, whoever reads it.
    const all = await standing(actors.analyst, NOW);
    const numbers = all.flatMap((s) => s.rules.flatMap((r) => r.notices.map((n) => n.number)));
    expect(numbers).not.toContain(cases.unsent);
    expect(numbers).not.toContain(cases.old);
  });

  it("measures the fleet as it stands against the cap, the equity minimum and the dwell limit", async () => {
    const [mine] = await standing(actors.kestrel, NOW);
    expect(mine!.now).toMatchObject({ onStreet: 11, permitted: 10, available: 10, inEquity: 4, equityZones: 1, nearingDwell: 1, pastDwell: 1, dwellWarningHours: 48, asOf: NOW - 60_000 });
    const [theirs] = await standing(actors.pronghorn, NOW);
    expect(theirs!.now).toMatchObject({ onStreet: 5, permitted: 3, available: 5, inEquity: 5, nearingDwell: 0, pastDwell: 5 });
  });

  it("is refused to a seat with no business in compliance, and the refusal is on record", async () => {
    await expect(standing(actors.finance, NOW)).rejects.toBeInstanceOf(Refused);
    expect(await refusals(actors.finance, "standing")).toHaveLength(1);
    const [read] = await sql`select allowed, operator_id from audit_log where user_id = ${actors.kestrel.userId} and resource = 'standing' order by id limit 1`;
    expect(read).toMatchObject({ allowed: true, operator_id: op.kestrel });
  });
});

describe.skipIf(!db)("one operator asking for another's records", () => {
  it("is told a case or finding of another operator does not exist, and the attempt is logged as refused", async () => {
    expect(await caseDetail(actors.kestrel, cases.theirs)).toBeNull();
    expect(await violationDetail(actors.kestrel, findings.theirs)).toBeNull();
    expect(await refusals(actors.kestrel, "case")).toContainEqual(expect.objectContaining({ found: false }));
    expect(await refusals(actors.kestrel, "finding")).toContainEqual(expect.objectContaining({ found: false }));
    // The owner and the city can both open them.
    expect((await caseDetail(actors.pronghorn, cases.theirs))?.number).toBe(cases.theirs);
    expect((await violationDetail(actors.analyst, findings.theirs))?.number).toBe(findings.theirs);
  });

  it("is refused another operator's invoice and its trip ledger, even once issued", async () => {
    await expect(invoiceDetail(actors.kestrel, "T-2026-10-PRO")).rejects.toBeInstanceOf(Refused);
    await expect(invoiceDetail(actors.kestrel, "T-2026-10-PRO", "export", "pdf")).rejects.toBeInstanceOf(Refused);
    await expect(invoiceTrips(actors.kestrel, "T-2026-10-PRO")).rejects.toBeInstanceOf(Refused);
    expect(await refusals(actors.kestrel, "invoice")).toHaveLength(2);
    expect(await refusals(actors.kestrel, "invoice_trip_ledger")).toHaveLength(1);
    expect((await invoiceDetail(actors.pronghorn, "T-2026-10-PRO"))?.number).toBe("T-2026-10-PRO");
  });

  it("gets only its own rows from every list the console serves", async () => {
    const queue = await caseQueue(actors.kestrel, { status: "all", operator: null, rule: null, flag: null, page: 1 });
    expect(new Set(queue.rows.map((r) => r.operator))).toEqual(new Set(["kestrel"]));
    expect(queue.operators.map((o) => o.slug)).toEqual(["kestrel"]);
    // Naming the other operator in the filter gets nothing, not their cases.
    expect((await caseQueue(actors.kestrel, { status: "all", operator: "pronghorn", rule: null, flag: null, page: 1 })).rows).toEqual([]);
    expect((await liveCases(actors.kestrel)).map((c) => c.number)).toEqual([cases.fined]);
    expect((await invoiceList(actors.kestrel)).map((i) => i.number)).toEqual(["T-2026-10-KES"]);
    expect((await dataHealth(actors.kestrel, 7)).operators.map((o) => o.slug)).toEqual(["kestrel"]);
    expect((await feedsNow(actors.kestrel)).map((f) => f.slug)).toEqual(["kestrel"]);
    expect((await records(actors.kestrel)).map((r) => r.operatorId)).toEqual([op.kestrel]);
    const map = await liveMap(actors.kestrel);
    expect(map.vehicles).toHaveLength(12);
    expect(new Set(map.vehicles.map((v) => v.operator))).toEqual(new Set(["kestrel"]));
    expect(map.operators.map((o) => o.slug)).toEqual(["kestrel"]);
  });
});

describe.skipIf(!db)("the city's working material", () => {
  it("keeps a case from the operator until a notice is recorded on it", async () => {
    const queue = await caseQueue(actors.kestrel, { status: "all", operator: null, rule: null, flag: null, page: 1 });
    expect(queue.rows.map((r) => r.number)).not.toContain(cases.unsent);
    expect(queue.totals.open).toBe(0);
    expect(await caseDetail(actors.kestrel, cases.unsent)).toBeNull();
    expect(await violationDetail(actors.kestrel, findings.unsent)).toBeNull();
    expect((await caseDetail(actors.analyst, cases.unsent))?.number).toBe(cases.unsent);
  });

  it("keeps a finding still being checked, and the city's notes, from the operator", async () => {
    const mine = (await caseDetail(actors.kestrel, cases.fined))!;
    expect(mine.findings.map((f) => f.number)).toEqual([findings.counted]);
    expect(await violationDetail(actors.kestrel, findings.held)).toBeNull();
    expect(JSON.stringify(mine)).not.toContain(STAFF_NOTE);
    const closed = (await caseDetail(actors.kestrel, cases.warned))!;
    expect(closed.events.map((e) => e.kind)).toEqual(["notice", "resolved"]);
    expect(JSON.stringify(closed)).not.toContain(CLOSING_NOTE);

    const city = (await caseDetail(actors.analyst, cases.fined))!;
    expect(city.findings.map((f) => f.number)).toEqual([findings.counted, findings.held]);
    expect(JSON.stringify(city)).toContain(STAFF_NOTE);
  });

  it("keeps a draft invoice from the operator until it is issued", async () => {
    expect(await invoiceDetail(actors.kestrel, "T-2026-11-KES")).toBeNull();
    expect(await invoiceTrips(actors.kestrel, "T-2026-11-KES")).toBeNull();
    expect((await invoiceDetail(actors.finance, "T-2026-11-KES"))?.status).toBe("draft");
  });

  it("leaves a line in the audit log for every one of the operator's reads", async () => {
    const rows = await sql`select resource, allowed, operator_id from audit_log where user_id = ${actors.kestrel.userId}`;
    for (const resource of ["standing", "case_queue", "case", "finding", "invoice_list", "invoice", "invoice_trip_ledger", "data_health", "live_map"]) expect(rows.map((r) => r.resource)).toContain(resource);
    // Nothing the operator was allowed to read is filed under another operator.
    expect(rows.filter((r) => r.allowed && r.operator_id !== op.kestrel)).toEqual([]);
  });
});
