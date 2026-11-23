// The demonstration's own past, and the way back to it.
//
// A seeded database has more than feeds in it: staff have been working the cases, operators have
// answered, alerts were raised and mail written. That scripted history is built here, through the
// same code the application uses, so the seed can lay it down and a hosted copy can put it back
// after visitors have tried the forms. None of this belongs in a deployment with real operators:
// resetDemo() discards what staff have recorded, and nothing calls it unless DEMO_RESET is set.

import { addDays, caseWeek, CITY_TIME_ZONE, localDate, RULE_KINDS, RULES, startOfLocalDay, type CaseAction, type RuleKind } from "@mm/core";
import type { Sql } from "@mm/db";
import { DIGEST_HOUR, raiseAlerts, sendDigests } from "./alerts";
import { actOnCase, ruleOnFinding, type CaseActor } from "./cases";
import { generateInvoice } from "./invoices";
import { sendMonthlyReport } from "./monthly";
import { detectViolations } from "./violations";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(2, "0");

/** The six seats, one person each, and an account for each operator. Safe to run on a database that already has people. */
export async function people(sql: Sql) {
  const ids = Object.fromEntries((await sql`select id, slug from operators`).map((r) => [r.slug, r.id]));
  const users: [string, string, string, string, string | null][] = [
    ["Marisol Vega", "marisol.vega@city-demo.example", "Mobility Program Manager", "program_manager", null],
    ["Devin Okafor", "devin.okafor@city-demo.example", "Compliance Analyst", "analyst", null],
    ["Priya Raman", "priya.raman@city-demo.example", "Revenue Analyst, Finance", "finance", null],
    ["Tomasz Brandt", "tomasz.brandt@city-demo.example", "IT Systems Administrator", "admin", null],
    ["Ruth Halloran", "ruth.halloran@city-demo.example", "Council Office Liaison", "read_only", null],
    ["Kestrel Mobility", "ops@kestrel-demo.example", "Operator account", "operator", "kestrel"],
    ["Pronghorn Rides", "ops@pronghorn-demo.example", "Operator account", "operator", "pronghorn"],
    ["Saltgrass Bikeshare", "ops@saltgrass-demo.example", "Operator account", "operator", "saltgrass"],
  ];
  for (const [name, email, title, role, slug] of users) {
    const updated = await sql`update users set name = ${name}, title = ${title}, role = ${role}, operator_id = ${slug ? ids[slug] : null} where email = ${email} returning id`;
    if (updated.length === 0) await sql`insert into users (name, email, title, role, operator_id) values (${name}, ${email}, ${title}, ${role}, ${slug ? ids[slug] : null})`;
  }
}

/** The rules and seeded zones came into force with the 2026 permit terms. */
export const ADOPTED = "2026-01-01T07:00:00Z";

export async function adoptRules(sql: Sql) {
  for (const kind of RULE_KINDS) {
    await sql`insert into rules (kind, params, effective_from, updated_by, updated_at) values (${kind}, ${sql.json(RULES[kind].defaults)}, ${ADOPTED}, 'Marisol Vega', '2025-12-09 21:20:00+00')
      on conflict (kind) do nothing`;
  }
}

type Who = "analyst" | "manager" | "operator";
/** One thing done to a case: who did it, how many days after the case's week ended, at what hour, and what they wrote. */
type Step = [action: CaseAction, who: Who, day: number, hour: number, note: string];

const NOTICE: Record<RuleKind, string> = {
  fleet_cap: "The fleet was over the permitted number on the days listed. Tell us what has been done to bring it back under the permit, or dispute the count.",
  equity_minimum: "The morning count in the equity zones was below the required share on the days listed. Tell us how vehicles will be redeployed, or dispute the count.",
  parking_dwell: "The vehicles listed stood in one place for longer than the limit. Tell us they have been collected, or dispute any that were not where the record says.",
  rebalancing_sla: "More badly parked vehicles were left past the deadline than the daily allowance, on the days listed. Tell us what has changed in your collection rounds, or dispute the record.",
  slow_zone_speed: "More rides than the rule allows went through slow zones above the limit on the days listed. Tell us when speed limiting inside these zones will be in place, or dispute the measurements.",
};
const FIXED: Record<RuleKind, [reply: string, close: string]> = {
  fleet_cap: ["The extra vehicles were collected on Tuesday and our deployment tool now stops at the permitted number.", "Counts since the reply are under the permit. Closed."],
  equity_minimum: ["We have added a 6 am drop at four west-side corners from next Monday.", "The morning drop is on the schedule the operator sent. To be judged on the following weeks' counts. Closed."],
  parking_dwell: ["All of the vehicles listed have been collected. Several had flat batteries and were not showing on our crew's route.", "Checked against the feed: every vehicle listed has moved or left the street. Closed."],
  rebalancing_sla: ["We have added an evening collection run downtown and the crew now works from the city's zone map.", "Missed deadlines fell back inside the allowance in the days after the reply. Closed."],
  slow_zone_speed: ["A firmware update with speed limiting inside the city's slow zones is being rolled out across the fleet.", "The operator has given a date for the firmware update. The notice stands; the weeks after it will show whether it worked. Closed."],
};

/** What happened to each case, by operator, rule and how many weeks ago its week began. Anything not listed is left as the engine filed it. */
function script(slug: string, rule: RuleKind, weeksAgo: number, ladderFrom: string): Step[] {
  const [reply, close] = FIXED[rule];
  const worked = (noticeDay: number, replyDay: number, closeDay: number): Step[] => [["notice", "analyst", noticeDay, 10, NOTICE[rule]], ["reply", "operator", replyDay, 14, reply], ["resolve", "analyst", closeDay, 11, close]];
  // Before the ladder was adopted, breaches were raised on the weekly call and nothing was put in writing.
  if (weeksAgo >= 4 && slug !== "saltgrass") return [["close", "analyst", 1, 9, `Raised on the weekly operator call. Closed without a notice: the escalation ladder was adopted on ${ladderFrom}, and weeks before it are not counted.`]];

  if (slug === "pronghorn") {
    if (weeksAgo === 3) return worked(0, 2, 4);
    if (rule === "fleet_cap") {
      if (weeksAgo === 2) return [
        ["notice", "analyst", 0, 10, NOTICE[rule]],
        ["dispute", "operator", 1, 16, "The extra vehicles were deployed for the downtown arts festival under special event permit SE-2026-118, which allows 60 vehicles above our cap while the festival is on."],
        ["withdraw", "analyst", 3, 15, "Confirmed with the events office: permit SE-2026-118 covered the festival days. Withdrawn. The cap in this system did not know about the event permit."],
      ];
      if (weeksAgo === 1) return [["notice", "analyst", 0, 10, NOTICE[rule]], ["reply", "operator", 3, 13, "Forty vehicles were taken off the street on Wednesday. We are asking for the additional 50 devices approved in October to be reflected in the cap for the days before the 15th."]];
    }
    if (rule === "equity_minimum") {
      if (weeksAgo === 2) return [["notice", "analyst", 1, 10, NOTICE[rule]]];
    }
    if (rule === "parking_dwell") {
      if (weeksAgo === 2) return worked(0, 2, 3);
      if (weeksAgo === 1) return [["notice", "analyst", 0, 11, NOTICE[rule]]];
    }
    if (rule === "rebalancing_sla") {
      if (weeksAgo === 2) return worked(0, 3, 4);
      if (weeksAgo === 1) return [
        ["notice", "analyst", 0, 11, NOTICE[rule]],
        ["dispute", "operator", 2, 15, "Some of the vehicles counted were at the racks beside the Gallivan Center, which sit on the edge of the no-parking zone as drawn. We ask for those to be taken out and the days counted again."],
      ];
    }
    if (rule === "slow_zone_speed") {
      if (weeksAgo === 2) return worked(0, 1, 3);
      if (weeksAgo === 1) return worked(0, 2, 3);
      if (weeksAgo === 0) return [["notice", "manager", -3, 15, `${NOTICE[rule]} This is the fourth week with a notice on this rule. The permit is referred for a suspension review; the hearing date will follow by letter.`]];
    }
  }
  if (slug === "kestrel") {
    if (rule === "parking_dwell") {
      if (weeksAgo === 3) return [["close", "analyst", 0, 10, "Four vehicles, all collected within a day of the limit. Raised by phone; no notice."]];
      if (weeksAgo === 2) return worked(0, 1, 2);
      if (weeksAgo === 1) return [["notice", "analyst", 1, 10, NOTICE[rule]], ["reply", "operator", 4, 9, "Six of the seven have been collected. The seventh is inside a locked courtyard on 300 South and we are waiting for the building manager."]];
    }
    if (rule === "rebalancing_sla" && weeksAgo === 3) return worked(0, 1, 2);
  }
  if (slug === "saltgrass") {
    if (weeksAgo >= 4) return [["close", "analyst", 2, 10, "Could not be confirmed: the operator's status feed was rejecting records at the time, so the stay cannot be shown to be unbroken. Closed without a notice. The feed fault has been raised with the operator."]];
    if (weeksAgo === 2) return worked(1, 2, 3);
  }
  return [];
}

/**
 * Gives the cases a believable past: staff have been working them, operators have answered, one notice was
 * disputed and withdrawn, one is overdue. Every step goes through the same code the application uses.
 */
async function workCases(sql: Sql, now: number) {
  const users = await sql`select id, name, role, operator_id from users`;
  const seat = (role: string) => users.find((u) => u.role === role)!;
  const actors: Record<Who, (operatorId: string) => CaseActor> = {
    analyst: () => ({ userId: seat("analyst").id, name: seat("analyst").name, operatorId: null, mayEscalate: false }),
    manager: () => ({ userId: seat("program_manager").id, name: seat("program_manager").name, operatorId: null, mayEscalate: true }),
    operator: (operatorId) => {
      const u = users.find((x) => x.operator_id === operatorId)!;
      return { userId: u.id, name: u.name, operatorId, mayEscalate: false };
    },
  };
  const thisWeek = caseWeek(now);
  const ladderFrom = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", day: "numeric" }).format(Date.parse(`${addDays(thisWeek, -21)}T00:00:00Z`));
  const analyst = { name: seat("analyst").name as string };

  const cases = await sql`select c.number, c.rule_kind, c.operator_id, c.week_start::text as week_start, o.slug from cases c join operators o on o.id = c.operator_id order by c.week_start, c.number`;
  for (const c of cases) {
    const weeksAgo = Math.round((Date.parse(thisWeek) - Date.parse(c.week_start)) / (7 * DAY));
    const weekEnd = addDays(c.week_start, 7);
    const at = (day: number, hour: number) => startOfLocalDay(addDays(weekEnd, day)) + hour * HOUR + ((Number(c.number) * 7) % 50) * 60_000;

    // One of Saltgrass's held findings was checked on the street and released, so it has a case that went to notice.
    if (c.slug === "saltgrass" && weeksAgo === 2) {
      const [held] = await sql`select v.number from violations v join cases k on k.id = v.case_id where k.number = ${c.number} and v.standing = 'held' order by v.number limit 1`;
      if (held && at(0, 15) < now) await ruleOnFinding(sql, Number(held.number), "counted", analyst, "Field check: the bike was at the rack on 400 West with a flat tyre and a full layer of leaves on the saddle. It has not moved. Released.", at(0, 15));
    }
    // And one of Pronghorn's was at its own depot, which the city agreed is not the street.
    if (c.slug === "pronghorn" && c.rule_kind === "parking_dwell" && weeksAgo === 1) {
      const [first] = await sql`select v.number from violations v join cases k on k.id = v.case_id where k.number = ${c.number} order by v.number limit 1`;
      if (first && at(0, 9) < now) await ruleOnFinding(sql, Number(first.number), "set_aside", analyst, "This vehicle was in the operator's depot yard, which is private land and not on the street. Set aside.", at(0, 9));
    }

    for (const [action, who, day, hour, note] of script(c.slug, c.rule_kind, weeksAgo, ladderFrom)) {
      const when = at(day, hour);
      if (when > now - HOUR) break;
      const problem = await actOnCase(sql, Number(c.number), action, actors[who](c.operator_id), note, when);
      if (problem) throw new Error(`Seeding case ${c.number} (${c.slug}, ${c.rule_kind}, ${c.week_start}): ${action} failed: ${problem}`);
    }
  }
}

/** Raises the alerts the last week called for, and the emails they would have produced, as if the worker had been running throughout. */
async function seedAlerts(sql: Sql, now: number) {
  await raiseAlerts(sql, now);
  const today = localDate(now);
  for (let back = 6; back >= 0; back--) {
    const morning = startOfLocalDay(addDays(today, -back)) + DIGEST_HOUR * HOUR;
    if (morning <= now) await sendDigests(sql, morning);
  }
  // The monthly report for each finished month on record, written on the first morning of the month after.
  for (const { year, month } of await finishedMonths(sql, now)) {
    let morning = startOfLocalDay(monthAfter(year, month)) + DIGEST_HOUR * HOUR;
    // The first of November can be the day the clocks go back, which makes its morning an hour later.
    const localHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: CITY_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(morning));
    morning += (DIGEST_HOUR - localHour) * HOUR;
    await sendMonthlyReport(sql, year, month, morning);
  }
  // Anything more than a day and a half old has been seen.
  await sql`update alerts set read_at = at + interval '3 hours' where at < ${new Date(now - 36 * HOUR)}`;
}

/** The first day of the month after the one given. */
const monthAfter = (year: number, month: number) => (month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`);

/** The finished months that have invoices: the months the demonstration has a full record of. */
async function finishedMonths(sql: Sql, now: number): Promise<{ year: number; month: number }[]> {
  const rows = await sql`select distinct year, month from invoices order by year, month`;
  return rows.map((r) => ({ year: Number(r.year), month: Number(r.month) })).filter((m) => monthAfter(m.year, m.month) <= localDate(now));
}

/**
 * Runs the rule engine over the whole stored history, then works the queue. Everything staff and
 * operators have recorded on cases is discarded first. `raw` stops after the findings are filed.
 */
export async function rebuildCases(sql: Sql, now: number, options: { raw?: boolean } = {}): Promise<number> {
  await sql`truncate cases, case_events, violations, alerts, outbox restart identity cascade`;
  await people(sql);
  await adoptRules(sql);
  const [first] = await sql`select min(ts) as ts from status_events`;
  if (!first?.ts) return 0;
  const result = await detectViolations(sql, { from: first.ts.getTime(), to: now });
  if (options.raw) return result.created;
  await workCases(sql, now);
  // The first run filed the history; this one sees it as the worker would, with the cases as staff left them.
  await detectViolations(sql, { from: now - 2 * DAY, to: now });
  await seedAlerts(sql, now);
  return result.created;
}

/**
 * The invoices as the demonstration starts: Kestrel's count agrees with its report, so finance has
 * issued its invoice for each finished month and the operator has one to open. The others are left
 * in draft, where the difference from the operator's report is still to be dealt with.
 */
export async function issueOpeningInvoices(sql: Sql, now: number) {
  const finance = (await sql`select name from users where role = 'finance' order by name limit 1`)[0]?.name ?? "Finance";
  const rows = await sql`select i.id, i.year, i.month from invoices i join operators o on o.id = i.operator_id
    where o.slug = 'kestrel' and i.status = 'draft' and not i.flagged and i.reported_trips is not null`;
  for (const row of rows) {
    // Signed off on the afternoon of the third day of the month after.
    const signed = startOfLocalDay(addDays(monthAfter(Number(row.year), Number(row.month)), 2)) + 15 * HOUR;
    if (signed > now) continue;
    await sql`update invoices set status = 'issued', issued_at = ${new Date(signed)}, issued_by = ${finance}, issue_note = null where id = ${row.id}`;
  }
}

/** Taken for the length of a reset, so two of them cannot run through each other. */
const RESET_LOCK = 7_210_410;

/**
 * Puts back everything a visitor to the demonstration can change: zones drawn or retired, rules,
 * fee schedules, invoices issued, cases, alerts, the outbox and the audit log. The feeds' history
 * (vehicles, rides, feed checks) is not touched, so this takes seconds where a reseed takes minutes.
 *
 * Returns false, having done nothing, when another reset is already running. It is not one
 * transaction: for the few seconds it runs, a reader can see the case queue part built.
 */
export async function resetDemo(sql: Sql, now = Date.now()): Promise<boolean> {
  const held = await sql.reserve();
  try {
    const [lock] = await held`select pg_try_advisory_lock(${RESET_LOCK}) as taken`;
    if (!lock!.taken) return false;
    try {
      // Zones a visitor added go, with what rides were recorded against them; zones a visitor retired come back.
      await sql`delete from zone_passes where zone_id in (select id from zones where source <> 'seed')`;
      await sql`delete from zones where source <> 'seed'`;
      await sql`update zones set retired_at = null, retired_by = null, active = true where retired_at is not null or not active`;

      await sql`delete from rules`;
      await adoptRules(sql);

      // The schedule the demonstration began with is the earliest on record; a schedule can only be adopted for a later date.
      await sql`delete from fee_schedules where id not in (select id from fee_schedules order by effective_from, created_at limit 1)`;
      await sql`update invoices set status = 'draft', issued_at = null, issued_by = null, issue_note = null where status = 'issued'`;
      const drafts = await sql`select i.operator_id, i.year, i.month, i.generated_at, o.slug from invoices i join operators o on o.id = i.operator_id`;
      for (const d of drafts) await generateInvoice(sql, { id: d.operator_id, slug: d.slug }, Number(d.year), Number(d.month), d.generated_at.getTime());
      await issueOpeningInvoices(sql, now);

      await sql`truncate audit_log restart identity`;
      await rebuildCases(sql, now);
      return true;
    } finally {
      await held`select pg_advisory_unlock(${RESET_LOCK})`;
    }
  } finally {
    held.release();
  }
}
