import { describe, expect, it } from "vitest";
import { digest, planAlerts, type AlertFacts, type AlertPerson, type CaseFact } from "./alerts";
import { ROLES } from "./access";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 20, 18);
const people: AlertPerson[] = [
  { userId: "pm", name: "Marisol Vega", role: "program_manager", operatorId: null },
  { userId: "an", name: "Devin Okafor", role: "analyst", operatorId: null },
  { userId: "fi", name: "Priya Raman", role: "finance", operatorId: null },
  { userId: "it", name: "Tomasz Brandt", role: "admin", operatorId: null },
  { userId: "ro", name: "Ruth Halloran", role: "read_only", operatorId: null },
  { userId: "kes", name: "Kestrel Mobility", role: "operator", operatorId: "op-k" },
  { userId: "pro", name: "Pronghorn Rides", role: "operator", operatorId: "op-p" },
];
const aCase = (over: Partial<CaseFact> = {}): CaseFact => ({
  id: "c1", number: 12, rule: "Slow zone speed", operatorId: "op-p", operatorName: "Pronghorn Rides", week: "16 November", status: "open", step: null, nextStep: 1,
  openedAt: now - DAY, dueAt: null, replied: false, counted: 3, ...over,
});
const facts = (over: Partial<AlertFacts> = {}): AlertFacts => ({ now, people, cases: [], events: [], outages: [], holds: [], invoices: [], changes: [], day: (d) => d, ...over });
const who = (alerts: { userId: string }[]) => [...new Set(alerts.map((a) => a.userId))].sort();

describe("who is told about a case", () => {
  it("tells the analysts about a new case, once, however many findings it holds", () => {
    const alerts = planAlerts(facts({ cases: [aCase({ counted: 40 })], events: [{ caseId: "c1", kind: "opened", at: now - DAY, actorId: null }] }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ userId: "an", key: "case.new:c1", urgent: false });
  });
  it("says nothing about a case with nothing firm in it", () => {
    expect(planAlerts(facts({ cases: [aCase({ status: "held", counted: 0 })], events: [{ caseId: "c1", kind: "opened", at: now, actorId: null }] }))).toEqual([]);
  });
  it("tells only that operator about its notice, and never another operator", () => {
    const alerts = planAlerts(facts({ cases: [aCase({ status: "notified", step: 2, dueAt: now + 5 * DAY })], events: [{ caseId: "c1", kind: "notice", at: now, actorId: "an" }] }));
    expect(who(alerts)).toEqual(["pro"]);
    expect(alerts[0]!.body).toContain("A fine of $250.");
  });
  it("sends a dispute to the analysts and the program manager at once", () => {
    const alerts = planAlerts(facts({ cases: [aCase({ status: "disputed", step: 1, dueAt: now + 5 * DAY })], events: [{ caseId: "c1", kind: "dispute", at: now, actorId: "pro" }] }));
    expect(who(alerts)).toEqual(["an", "pm"]);
    expect(alerts.every((a) => a.urgent)).toBe(true);
  });
  it("tells the program manager when the next notice is a second fine or a permit review, and not before", () => {
    expect(planAlerts(facts({ cases: [aCase({ nextStep: 2 })] }))).toEqual([]);
    const fine = planAlerts(facts({ cases: [aCase({ nextStep: 3 })] }));
    expect(fine).toHaveLength(1);
    expect(fine[0]).toMatchObject({ userId: "pm", urgent: false });
    const review = planAlerts(facts({ cases: [aCase({ nextStep: 4 })] }));
    expect(review[0]).toMatchObject({ userId: "pm", urgent: true });
    expect(review[0]!.body).toContain("Only the program manager");
  });
});

describe("deadlines", () => {
  const notified = (dueAt: number, over: Partial<CaseFact> = {}) => aCase({ status: "notified", step: 1, dueAt, ...over });
  it("warns both sides before the reply date, not only after it", () => {
    const alerts = planAlerts(facts({ cases: [notified(now + DAY)] }));
    expect(alerts.map((a) => a.kind).sort()).toEqual(["case.due_soon", "op.due_soon"]);
    expect(who(alerts)).toEqual(["an", "pro"]);
  });
  it("says nothing while the date is still far off", () => {
    expect(planAlerts(facts({ cases: [notified(now + 4 * DAY)] }))).toEqual([]);
  });
  it("raises a missed date as urgent for the analysts", () => {
    const alerts = planAlerts(facts({ cases: [notified(now - DAY)] }));
    expect(alerts.find((a) => a.userId === "an")).toMatchObject({ kind: "case.overdue", urgent: true });
  });
  it("stops chasing once the operator has replied", () => {
    expect(planAlerts(facts({ cases: [notified(now - DAY, { replied: true })] }))).toEqual([]);
  });
  it("chases the city's own decision on a dispute", () => {
    const soon = planAlerts(facts({ cases: [aCase({ status: "disputed", step: 1, dueAt: now + DAY })] }));
    expect(who(soon)).toEqual(["an", "pm"]);
    const late = planAlerts(facts({ cases: [aCase({ status: "disputed", step: 1, dueAt: now - DAY })] }));
    expect(late.every((a) => a.urgent && a.key.startsWith("case.decision_late"))).toBe(true);
  });
  it("uses a new key when a new date is set, so the next deadline is chased too", () => {
    const first = planAlerts(facts({ cases: [notified(now - DAY)] }))[0]!.key;
    const second = planAlerts(facts({ cases: [notified(now - DAY + 7 * DAY)], now: now + 7 * DAY }))[0]!.key;
    expect(first).not.toBe(second);
  });
});

describe("feeds, holds and invoices", () => {
  const outage = { operatorId: "op-p", operatorName: "Pronghorn Rides", date: "2026-11-20", outages: 5, minutes: 43, at: now - 3_600_000, downSince: null, held: 2 };
  it("tells the analysts, IT and the operator about a day's outages in one alert each, and leaves the program manager out", () => {
    const alerts = planAlerts(facts({ outages: [outage] }));
    expect(who(alerts)).toEqual(["an", "it", "pro"]);
    expect(alerts).toHaveLength(3);
    expect(alerts.every((a) => !a.urgent)).toBe(true);
    expect(alerts.find((a) => a.userId === "an")!.title).toBe("Pronghorn Rides' feed dropped 5 times on 2026-11-20");
    expect(alerts.find((a) => a.userId === "an")!.body).toContain("2 findings from that time are held.");
  });
  it("says nothing about a feed that missed a poll or two", () => {
    expect(planAlerts(facts({ outages: [{ ...outage, outages: 1, minutes: 2 }] }))).toEqual([]);
  });
  it("interrupts staff only when a feed has been silent for ten minutes and still is", () => {
    const brief = planAlerts(facts({ outages: [{ ...outage, downSince: now - 4 * 60_000 }] }));
    expect(brief.some((a) => a.urgent)).toBe(false);
    const long = planAlerts(facts({ outages: [{ ...outage, downSince: now - 25 * 60_000 }] }));
    expect(who(long.filter((a) => a.urgent))).toEqual(["an", "it", "pm"]);
  });
  it("groups held findings into one alert per operator and week", () => {
    const alerts = planAlerts(facts({ holds: [{ operatorId: "op-s", operatorName: "Saltgrass Bikeshare", weekStart: "2026-11-16", week: "16 November", count: 4, at: now }] }));
    expect(who(alerts)).toEqual(["an", "pm"]);
    expect(alerts[0]!.title).toBe("4 findings held: Saltgrass Bikeshare, week of 16 November");
  });
  it("sends an invoice to finance, and to the program manager only when it does not reconcile", () => {
    const invoice = { id: "i1", number: "MM-2026-10-KES", operatorId: "op-k", operatorName: "Kestrel Mobility", period: "October 2026", flagged: false, generatedAt: now, issuedAt: null };
    expect(who(planAlerts(facts({ invoices: [invoice] })))).toEqual(["fi"]);
    expect(who(planAlerts(facts({ invoices: [{ ...invoice, flagged: true }] })))).toEqual(["fi", "pm"]);
  });
  it("tells the operator once its invoice is issued", () => {
    const alerts = planAlerts(facts({ invoices: [{ id: "i1", number: "MM-2026-10-KES", operatorId: "op-k", operatorName: "Kestrel Mobility", period: "October 2026", flagged: false, generatedAt: now, issuedAt: now }] }));
    expect(who(alerts)).toEqual(["kes"]);
  });
});

describe("rule and zone changes", () => {
  const change = { key: "rule:parking_dwell:1", at: now, by: "Marisol Vega", title: "Rule changed: parking dwell", body: "Limit is now 48 hours.", href: "/rules" };
  it("go to the analysts and the operators, never back to whoever made the change", () => {
    expect(who(planAlerts(facts({ changes: [change] })))).toEqual(["an", "kes", "pro"]);
  });
  it("leave out an analyst who made the change themselves", () => {
    expect(who(planAlerts(facts({ changes: [{ ...change, by: "Devin Okafor" }] })))).toEqual(["kes", "pro"]);
  });
});

describe("the read-only seat", () => {
  it("is never alerted about anything", () => {
    const everything = planAlerts(facts({
      cases: [aCase({ status: "notified", step: 4, nextStep: 4, dueAt: now - DAY })],
      events: (["opened", "notice", "reply", "dispute", "upheld", "withdrawn", "follow_up", "resolved", "reopened"] as const).map((kind, i) => ({ caseId: "c1", kind, at: now - i, actorId: null })),
      outages: [{ operatorId: "op-p", operatorName: "Pronghorn Rides", date: "2026-11-20", outages: 1, minutes: 30, at: now, downSince: now - 3_600_000, held: 0 }],
      holds: [{ operatorId: "op-p", operatorName: "Pronghorn Rides", weekStart: "2026-11-16", week: "16 November", count: 1, at: now }],
      invoices: [{ id: "i", number: "N", operatorId: "op-p", operatorName: "Pronghorn Rides", period: "October 2026", flagged: true, generatedAt: now, issuedAt: null }],
      changes: [{ key: "k", at: now, by: "x", title: "t", body: "b", href: "/rules" }],
    }));
    expect(everything.some((a) => a.userId === "ro")).toBe(false);
    // Every other seat has something to hear.
    for (const role of ROLES.filter((r) => r !== "read_only")) expect(everything.some((a) => people.find((p) => p.userId === a.userId)!.role === role)).toBe(true);
  });
  it("never produces the same key twice for one person", () => {
    const alerts = planAlerts(facts({ cases: [aCase({ status: "notified", step: 1, dueAt: now + DAY })], events: [{ caseId: "c1", kind: "notice", at: now, actorId: null }] }));
    const keys = alerts.map((a) => `${a.userId}|${a.key}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the daily summary", () => {
  it("puts everything in one message", () => {
    const d = digest("Pronghorn Rides", [{ title: "Notice C-00012", body: "A fine.", href: "/cases/12" }, { title: "Rule changed", body: "48 hours.", href: "/rules" }], "20 November");
    expect(d.subject).toBe("2 updates for 20 November");
    expect(d.body).toContain("1. Notice C-00012");
    expect(d.body).toContain("2. Rule changed");
  });
  it("uses the alert itself as the subject when there is only one", () => {
    expect(digest("X", [{ title: "Notice C-00012", body: "", href: "" }], "d").subject).toBe("Notice C-00012");
  });
});
