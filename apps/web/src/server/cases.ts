// Cases: everything one operator did against one rule in one week, and what the city did about it.

import { can, type Actor } from "@mm/core/access";
import { ACTIONS, caseReference, ladderStep, LADDER_WINDOW_MONTHS, OPERATOR_SEES, type CaseAction, type CaseOutcome, type CaseStatus, type EventKind, type Standing } from "@mm/core/cases";
import type { HoldReason } from "@mm/core/confidence";
import type { RuleKind } from "@mm/core/rules";
import { raiseAlerts } from "@mm/ingest/alerts";
import { actOnCase, ruleOnFinding } from "@mm/ingest/cases";
import { reference } from "@/lib/violations";
import { authorize } from "./guard";
import { sql } from "./db";

export const PAGE_SIZE = 40;

/**
 * City staff see every case. An operator sees its own, and only once a notice has been
 * recorded: until then a case is the city's working material.
 */
const visibleTo = (actor: Actor) => (actor.role === "operator" ? sql`c.operator_id = ${actor.operatorId} and c.notified_at is not null` : sql`true`);

export type CaseRow = {
  id: string;
  number: number;
  ref: string;
  kind: RuleKind;
  operator: string;
  operatorName: string;
  operatorId: string;
  week: string;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  /** The rung the notice was recorded at; null until there is a notice. */
  step: number | null;
  /** The rung a notice recorded today would land on. */
  nextStep: number;
  openedAt: number;
  notifiedAt: number | null;
  dueAt: number | null;
  replied: boolean;
  statusChangedAt: number | null;
  statusChangedBy: string | null;
  findings: number;
  counted: number;
  held: number;
  setAside: number;
};

const caseRow = (r: Record<string, any>): CaseRow => ({
  id: r.id, number: Number(r.number), ref: caseReference(Number(r.number)), kind: r.rule_kind, operator: r.slug, operatorName: r.name, operatorId: r.operator_id, week: r.week,
  status: r.status, outcome: r.outcome, step: r.step, nextStep: ladderStep(r.prior).step, openedAt: r.opened_at.getTime(), notifiedAt: r.notified_at ? r.notified_at.getTime() : null,
  dueAt: r.due_at ? r.due_at.getTime() : null, replied: r.replied_at !== null, statusChangedAt: r.status_changed_at ? r.status_changed_at.getTime() : null, statusChangedBy: r.status_changed_by,
  findings: r.findings, counted: r.counted, held: r.held, setAside: r.set_aside,
});

/** A case with its operator, its findings counted by standing, and how many earlier notices count against it on the ladder. */
const CASES = sql`
  select c.*, c.week_start::text as week, o.slug, o.name, f.findings, f.counted, f.held, f.set_aside,
    (select count(*)::int from cases p where p.operator_id = c.operator_id and p.rule_kind = c.rule_kind and p.notified_at is not null and p.outcome is distinct from 'withdrawn'
      and p.week_start < c.week_start and p.week_start >= c.week_start - ${`${LADDER_WINDOW_MONTHS} months`}::interval) as prior
  from cases c join operators o on o.id = c.operator_id
  join lateral (select count(*)::int as findings, count(*) filter (where standing = 'counted')::int as counted, count(*) filter (where standing = 'held')::int as held,
    count(*) filter (where standing = 'set_aside')::int as set_aside from violations v where v.case_id = c.id) f on true`;

export const FLAGS = ["reply", "overdue"] as const;
export type Flag = (typeof FLAGS)[number];
export type QueueFilter = { status: CaseStatus | "all"; operator: string | null; rule: RuleKind | null; flag: Flag | null; page: number };

export async function caseQueue(actor: Actor, filter: QueueFilter) {
  await authorize(actor, "violations.view", { action: "read", resource: "case_queue" });
  const visible = visibleTo(actor);
  const flag = filter.flag === "reply" ? sql`c.replied_at is not null` : filter.flag === "overdue" ? sql`c.replied_at is null and c.due_at < now()` : sql`true`;
  const [groups, operators, rows] = await Promise.all([
    sql`select c.status, o.slug, c.rule_kind, count(*)::int as n,
        count(*) filter (where c.status = 'notified' and c.replied_at is not null)::int as replies,
        count(*) filter (where c.status = 'notified' and c.replied_at is null and c.due_at < now())::int as overdue,
        count(*) filter (where c.status = 'resolved' and c.status_changed_at > now() - interval '30 days')::int as recent
      from cases c join operators o on o.id = c.operator_id where ${visible} group by 1, 2, 3`,
    sql`select slug, name from operators o where ${actor.role === "operator" ? sql`o.id = ${actor.operatorId}` : sql`true`} order by name`,
    sql`${CASES}
      where ${visible}
        and ${filter.status === "all" ? sql`true` : sql`c.status = ${filter.status}`}
        and ${filter.operator ? sql`o.slug = ${filter.operator}` : sql`true`}
        and ${filter.rule ? sql`c.rule_kind = ${filter.rule}` : sql`true`}
        and ${flag}
      order by ${filter.status === "resolved" ? sql`c.status_changed_at desc nulls last,` : sql``} c.week_start desc, c.number desc
      limit ${PAGE_SIZE} offset ${(filter.page - 1) * PAGE_SIZE}`,
  ]);

  const tally = (keep: (g: Record<string, any>) => boolean, column = "n") => groups.filter(keep).reduce((sum, g) => sum + g[column], 0);
  const matches = (g: Record<string, any>, skip: "status" | "operator" | "rule") =>
    (skip === "status" || filter.status === "all" || g.status === filter.status) && (skip === "operator" || !filter.operator || g.slug === filter.operator) && (skip === "rule" || !filter.rule || g.rule_kind === filter.rule);
  const flagColumn = filter.flag === "reply" ? "replies" : filter.flag === "overdue" ? "overdue" : "n";
  return {
    rows: rows.map(caseRow),
    operators: operators.map((o) => ({ slug: o.slug as string, name: o.name as string })),
    /** Totals for every case this person can see, whatever is filtered. */
    totals: {
      open: tally((g) => g.status === "open"), notified: tally((g) => g.status === "notified"), disputed: tally((g) => g.status === "disputed"), held: tally((g) => g.status === "held"),
      resolved: tally((g) => g.status === "resolved"), replies: tally(() => true, "replies"), overdue: tally(() => true, "overdue"), resolvedRecently: tally(() => true, "recent"),
    },
    /** How many cases each choice of filter would show, given the other filters. */
    counts: {
      status: (status: CaseStatus | "all") => tally((g) => matches(g, "status") && (status === "all" || g.status === status)),
      operator: (slug: string | null) => tally((g) => matches(g, "operator") && (!slug || g.slug === slug)),
      rule: (kind: RuleKind | null) => tally((g) => matches(g, "rule") && (!kind || g.rule_kind === kind)),
    },
    matching: tally((g) => matches(g, "status") && (filter.status === "all" || g.status === filter.status), flagColumn),
  };
}

/** Every case that is not closed. Few enough to hand to a home screen whole. */
export async function liveCases(actor: Actor): Promise<CaseRow[]> {
  await authorize(actor, "violations.view", { action: "read", resource: "case_queue", detail: { view: "home" }, repeating: true });
  const rows = await sql`${CASES} where ${visibleTo(actor)} and c.status <> 'resolved' order by c.week_start desc, c.number desc`;
  return rows.map(caseRow);
}

export type CaseFinding = {
  number: number;
  ref: string;
  kind: RuleKind;
  periodStart: number;
  periodEnd: number | null;
  measured: number;
  threshold: number;
  evidence: unknown;
  params: unknown;
  standing: Standing;
  hold: HoldReason[];
  standingBy: string | null;
  standingAt: number | null;
  standingNote: string | null;
};
export type CaseEvent = { at: number; actorName: string; kind: EventKind; fromOperator: boolean; note: string | null };
export type LadderEntry = { number: number; ref: string; week: string; step: number; status: CaseStatus; outcome: CaseOutcome | null; counts: boolean };

export async function caseDetail(actor: Actor, number: number) {
  const [row] = await sql`${CASES} where c.number = ${number} and ${visibleTo(actor)}`;
  // An operator asking for a case it may not see gets "not found", but the attempt is still on record.
  if (!row) {
    await authorize(actor, "violations.view", { action: "read", resource: "case", detail: { number: caseReference(number), found: false }, withheld: true });
    return null;
  }
  await authorize(actor, "violations.view", { action: "read", resource: "case", operatorId: row.operator_id, detail: { number: caseReference(number) } });
  const isOperator = actor.role === "operator";
  const [findings, events, history] = await Promise.all([
    // A finding the city is still checking has not been put to the operator, so the operator is not shown it.
    sql`select * from violations where case_id = ${row.id} and ${isOperator ? sql`standing <> 'held'` : sql`true`} order by period_start, number`,
    sql`select at, actor_name, kind, from_operator, note from case_events where case_id = ${row.id} order by at, id`,
    sql`select number, week_start::text as week, step, status, outcome from cases
      where operator_id = ${row.operator_id} and rule_kind = ${row.rule_kind} and notified_at is not null and id <> ${row.id}
        and week_start < ${row.week}::date and week_start >= ${row.week}::date - ${`${LADDER_WINDOW_MONTHS} months`}::interval order by week_start`,
  ]);
  return {
    ...caseRow(row),
    findings: findings.map(
      (v): CaseFinding => ({
        number: Number(v.number), ref: reference(Number(v.number)), kind: v.rule_kind, periodStart: v.period_start.getTime(), periodEnd: v.period_end ? v.period_end.getTime() : null,
        measured: v.measured, threshold: v.threshold, evidence: v.evidence, params: v.rule_params, standing: v.standing, hold: (v.hold ?? []) as HoldReason[],
        standingBy: v.standing_by, standingAt: v.standing_at ? v.standing_at.getTime() : null, standingNote: isOperator ? null : v.standing_note,
      }),
    ),
    total: row.findings as number,
    events: events
      .filter((e) => !isOperator || OPERATOR_SEES.includes(e.kind))
      // What the two sides wrote to each other is shown to both. How the city closed a case is the city's own note.
      .map((e): CaseEvent => ({ at: e.at.getTime(), actorName: e.actor_name, kind: e.kind, fromOperator: e.from_operator, note: isOperator && e.kind === "resolved" ? null : e.note })),
    /** Earlier notices to this operator on this rule, oldest first: how the case came to be on the rung it is on. */
    history: history.map((h): LadderEntry => ({ number: Number(h.number), ref: caseReference(Number(h.number)), week: h.week, step: h.step, status: h.status, outcome: h.outcome, counts: h.outcome !== "withdrawn" })),
  };
}
export type CaseDetail = NonNullable<Awaited<ReturnType<typeof caseDetail>>>;

/** Carries out one step on a case for whoever is signed in. Returns a sentence when it cannot be done. */
export async function act(actor: Actor, number: number, action: CaseAction, note: string): Promise<string | null> {
  const [row] = await sql`select c.operator_id, c.status from cases c where c.number = ${number} and ${visibleTo(actor)}`;
  const detail = { number: caseReference(number), step: action };
  const permission = ACTIONS[action].by === "operator" ? "violations.reply" : "violations.change";
  if (!row) {
    await authorize(actor, permission, { action: "change", resource: "case", detail: { ...detail, found: false }, withheld: true });
    return "That case no longer exists.";
  }
  await authorize(actor, permission, { action: "change", resource: "case", operatorId: row.operator_id, detail: { ...detail, from: row.status } });
  const problem = await actOnCase(sql, number, action, { userId: actor.userId, name: actor.name, operatorId: actor.operatorId, mayEscalate: can(actor.role, "violations.escalate") }, note);
  // Whoever now needs to know is told straight away, not at the rule engine's next run.
  if (!problem) await raiseAlerts(sql);
  return problem;
}

/** Releases a held finding so that it counts, or sets a finding aside so that it does not. */
export async function rule(actor: Actor, number: number, to: "counted" | "set_aside", note: string): Promise<{ problem: string | null; caseNumber: number | null }> {
  const [row] = await sql`select v.operator_id, v.standing, c.number as case_number from violations v join cases c on c.id = v.case_id where v.number = ${number}`;
  await authorize(actor, "violations.change", { action: "change", resource: "finding", operatorId: row?.operator_id ?? null, detail: { number: reference(number), to, ...(row ? { from: row.standing } : { found: false }) } });
  if (!row) return { problem: "That finding no longer exists.", caseNumber: null };
  const problem = await ruleOnFinding(sql, number, to, { name: actor.name }, note);
  if (!problem) await raiseAlerts(sql);
  return { problem, caseNumber: Number(row.case_number) };
}
