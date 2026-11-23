// What each seat's home screen needs beyond the cases and invoices it already reads.

import { can, type Actor } from "@mm/core/access";
import { LADDER_WINDOW_MONTHS } from "@mm/core/cases";
import { healthScore, type Health } from "@mm/core/health";
import type { RuleKind } from "@mm/core/rules";
import { authorize } from "./guard";
import { sql } from "./db";
import { counts, MEASURES } from "./health";

export type FeedNow = {
  operatorId: string;
  slug: string;
  name: string;
  /** The last 24 hours. */
  health: Health;
  failedPolls: number;
  polls: number;
  lastPolled: number | null;
  /** Set while the operator's live feed is not answering. */
  downSince: number | null;
  /** Findings waiting on a check of the data. Null for a seat that does not see cases. */
  held: number | null;
};

/** Each operator's feeds as they stand now. An operator sees its own. */
export async function feedsNow(actor: Actor): Promise<FeedNow[]> {
  const scope = await authorize(actor, "health.view", { action: "read", resource: "data_health", detail: { view: "home" }, repeating: true });
  const mine = scope ? sql`operator_id = ${scope}` : sql`true`;
  const seesCases = can(actor.role, "violations.view") && actor.role !== "operator";
  const [operators, totals, recent, held] = await Promise.all([
    sql`select id, slug, name from operators where ${scope ? sql`id = ${scope}` : sql`true`} order by name`,
    sql`select operator_id, ${MEASURES}, max(polled_at) as last_polled from feed_polls where polled_at > now() - interval '1 day' and ${mine} group by 1`,
    sql`select operator_id, polled_at, outcome from feed_polls where period_hour is null and polled_at > now() - interval '3 hours' and ${mine} order by operator_id, polled_at desc`,
    seesCases ? sql`select v.operator_id, count(*)::int as n from violations v join cases c on c.id = v.case_id where v.standing = 'held' and c.status in ('held', 'open') group by 1` : Promise.resolve([] as Record<string, any>[]),
  ]);
  return operators.map((o) => {
    const t = totals.find((x) => x.operator_id === o.id);
    const polls = recent.filter((x) => x.operator_id === o.id);
    // Down now: the latest poll failed. It has been down since the oldest of the unbroken run of failures.
    let downSince: number | null = null;
    for (const p of polls) {
      if (p.outcome === "ok") break;
      downSince = p.polled_at.getTime();
    }
    const c = counts(t ?? { polls: 0, failed: 0, slow: 0, realtime: 0, stale: 0, records: 0, invalid: 0, incomplete: 0 });
    return {
      operatorId: o.id, slug: o.slug, name: o.name, health: healthScore(c), failedPolls: c.failedPolls, polls: c.polls, lastPolled: t?.last_polled ? t.last_polled.getTime() : null, downSince,
      held: seesCases ? (held.find((h) => h.operator_id === o.id)?.n ?? 0) : null,
    };
  });
}

export type Record12 = {
  operatorId: string;
  /** Per rule: notices in the last twelve months that were not withdrawn, and the highest rung reached. */
  rules: { kind: RuleKind; notices: number; step: number }[];
  notices: number;
  topStep: number;
};

/** Each operator's record on the escalation ladder: what a council member, or the program manager, asks first. */
export async function records(actor: Actor): Promise<Record12[]> {
  const scope = await authorize(actor, "violations.view", { action: "read", resource: "case_queue", detail: { view: "record" }, repeating: true });
  const rows = await sql`select operator_id, rule_kind, count(*)::int as notices, max(step)::int as step from cases
    where notified_at is not null and outcome is distinct from 'withdrawn' and week_start >= current_date - ${`${LADDER_WINDOW_MONTHS} months`}::interval
      and ${scope ? sql`operator_id = ${scope}` : sql`true`} group by 1, 2 order by 4 desc, 3 desc`;
  const out = new Map<string, Record12>();
  for (const r of rows) {
    const rec = out.get(r.operator_id) ?? { operatorId: r.operator_id as string, rules: [], notices: 0, topStep: 0 };
    rec.rules.push({ kind: r.rule_kind, notices: r.notices, step: r.step });
    rec.notices += r.notices;
    rec.topStep = Math.max(rec.topStep, r.step);
    out.set(r.operator_id, rec);
  }
  return [...out.values()];
}

export type AuditPulse = { day: number; refusedDay: number; changesDay: number; refusals: { at: number; userName: string; role: string; action: string; resource: string; detail: Record<string, unknown> | null }[] };

export async function auditPulse(actor: Actor): Promise<AuditPulse> {
  await authorize(actor, "audit.view", { action: "read", resource: "audit_log", detail: { view: "home" }, repeating: true });
  const [[n], refusals] = await Promise.all([
    sql`select count(*)::int as day, count(*) filter (where not allowed)::int as refused, count(*) filter (where action = 'change' and allowed)::int as changes from audit_log where at > now() - interval '1 day'`,
    sql`select at, user_name, role, action, resource, detail from audit_log where not allowed order by id desc limit 4`,
  ]);
  return { day: n!.day, refusedDay: n!.refused, changesDay: n!.changes, refusals: refusals.map((r) => ({ at: r.at.getTime(), userName: r.user_name, role: r.role, action: r.action, resource: r.resource, detail: r.detail })) };
}

/** How many messages are in the outbox, and when the last one was written. */
export async function outboxPulse(actor: Actor): Promise<{ total: number; last: number | null }> {
  await authorize(actor, "outbox.view", { action: "read", resource: "outbox", detail: { view: "home" }, repeating: true });
  const [row] = await sql`select count(*)::int as total, max(at) as last from outbox`;
  return { total: row!.total, last: row!.last ? row!.last.getTime() : null };
}
