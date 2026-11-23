// What can be done to a case, and what each step changes. The web application and
// the seeded history both go through here, so a case can only ever be in a state
// the rules in @mm/core allow.

import { ACTIONS, DECISION_WORKING_DAYS, deadline, ladderStep, LADDER_WINDOW_MONTHS, RESPONSE_WORKING_DAYS, restingStatus, type CaseAction, type CaseStatus, type LadderStep } from "@mm/core";
import type { Sql } from "@mm/db";

export type CaseActor = { userId: string | null; name: string; operatorId: string | null; mayEscalate: boolean };

/** Earlier weeks in which this operator was given a notice on this rule that was not later withdrawn. */
export const priorNotices = (sql: Sql, c: { operatorId: string; ruleKind: string; weekStart: string }) => sql`
  select count(*)::int as n from cases
  where operator_id = ${c.operatorId} and rule_kind = ${c.ruleKind} and notified_at is not null and outcome is distinct from 'withdrawn'
    and week_start < ${c.weekStart}::date and week_start >= ${c.weekStart}::date - ${`${LADDER_WINDOW_MONTHS} months`}::interval`.then((rows) => rows[0]!.n as number);

/** The rung a notice on this case would land on today. */
export async function nextStep(sql: Sql, c: { operatorId: string; ruleKind: string; weekStart: string }): Promise<LadderStep> {
  return ladderStep(await priorNotices(sql, c));
}

/** Carries out one action on a case. Returns a sentence when it cannot be done. */
export async function actOnCase(sql: Sql, number: number, action: CaseAction, actor: CaseActor, note: string, at = Date.now()): Promise<string | null> {
  const rule = ACTIONS[action];
  const text = note.trim();
  if (rule.needsNote && !text) return rule.by === "operator" ? "Say something before sending: the city reads what you write here." : "Write a note first. It is the record of why this was done.";
  const [c] = await sql`select id, status, rule_kind, operator_id, week_start::text as week_start, step, notified_at from cases where number = ${number}`;
  if (!c) return "That case no longer exists.";
  const from = c.status as CaseStatus;
  if (rule.by === "operator" && actor.operatorId !== c.operator_id) return "That case belongs to another operator.";
  if (!rule.from.includes(from)) return `This case is now ${from}, so that can no longer be done. Reload the page to see what changed.`;

  const when = new Date(at);
  const set: Record<string, unknown> = { status: rule.to, status_changed_at: when, status_changed_by: actor.name };
  if (action === "notice") {
    const step = await nextStep(sql, { operatorId: c.operator_id, ruleKind: c.rule_kind, weekStart: c.week_start });
    if (step.needsProgramManager && !actor.mayEscalate) return "This notice would refer the permit for a suspension review. Only the program manager can record it.";
    const [firm] = await sql`select count(*)::int as n from violations where case_id = ${c.id} and standing = 'counted'`;
    if (firm!.n === 0) return "Every finding in this case is held or set aside, so there is nothing to put to the operator.";
    Object.assign(set, { step: step.step, notified_at: when, due_at: new Date(deadline(at, RESPONSE_WORKING_DAYS)), replied_at: null });
  }
  if (action === "reply") set.replied_at = when;
  if (action === "dispute") Object.assign(set, { due_at: new Date(deadline(at, DECISION_WORKING_DAYS)), replied_at: null });
  if (action === "uphold" || action === "follow_up") Object.assign(set, { due_at: new Date(deadline(at, RESPONSE_WORKING_DAYS)), replied_at: null });
  if (rule.to === "resolved") Object.assign(set, { outcome: rule.outcome, due_at: null, replied_at: null });
  if (action === "reopen") Object.assign(set, { outcome: null, due_at: null, replied_at: null });

  return sql.begin(async (tx) => {
    const updated = await tx`update cases set ${tx(set as never)} where id = ${c.id} and status = ${from} returning id`;
    if (updated.length === 0) return "Someone else changed this case a moment ago. Reload the page to see what they did.";
    await tx`insert into case_events ${tx({ case_id: c.id, at: when, actor_id: actor.userId, actor_name: actor.name, kind: rule.event, from_operator: rule.by === "operator", note: text || null })}`;
    return null;
  });
}

/**
 * Staff's ruling on one finding: release a held finding so that it counts, or set a finding aside so that it does not.
 * Once staff have ruled, the rule engine leaves the finding's standing alone.
 */
export async function ruleOnFinding(sql: Sql, number: number, to: "counted" | "set_aside", actor: { name: string }, note: string, at = Date.now()): Promise<string | null> {
  const text = note.trim();
  if (!text) return to === "counted" ? "Say what was checked before releasing a held finding." : "Say why this finding is being set aside.";
  const [v] = await sql`select v.id, v.standing, v.case_id, c.status from violations v join cases c on c.id = v.case_id where v.number = ${number}`;
  if (!v) return "That finding no longer exists.";
  if (v.status === "resolved") return "The case is closed. Reopen it before changing a finding.";
  if (v.standing === to) return "That has already been done. Reload the page.";
  if (to === "counted" && v.status !== "held" && v.status !== "open") return "The notice has already gone out without this finding. Close the case first, or leave the finding as it is.";
  await sql`update violations set standing = ${to}, standing_by = ${actor.name}, standing_at = ${new Date(at)}, standing_note = ${text} where id = ${v.id}`;
  if (v.status === "held" || v.status === "open") {
    const [n] = await sql`select count(*) filter (where standing = 'counted')::int as counted, count(*) filter (where standing = 'held')::int as held from violations where case_id = ${v.case_id}`;
    const status = restingStatus(n!.counted, n!.held);
    if (status !== v.status) await sql`update cases set status = ${status} where id = ${v.case_id}`;
  }
  return null;
}
