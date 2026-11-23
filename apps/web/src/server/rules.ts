// The city's rules and their settings.

import type { Actor } from "@mm/core/access";
import { RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { authorize } from "./guard";
import { sql, sqlNow } from "./db";

export type RuleRow = { kind: RuleKind; enabled: boolean; params: Record<string, number>; effectiveFrom: number; updatedBy: string; updatedAt: number; adopted: boolean; open: number; notified: number; disputed: number; held: number };

export async function ruleList(actor: Actor): Promise<RuleRow[]> {
  const scope = await authorize(actor, "rules.view", { action: "read", resource: "rules" });
  const [rows, counts] = await Promise.all([
    sql`select kind, enabled, params, effective_from, updated_by, updated_at from rules`,
    // Operators are shown the rules but not how many cases are being worked on.
    scope ? Promise.resolve([]) : sql`select rule_kind, status, count(*)::int as n from cases where status <> 'resolved' group by 1, 2`,
  ]);
  return RULE_KINDS.map((kind) => {
    const row = rows.find((r) => r.kind === kind);
    const n = (status: string) => (counts as Record<string, any>[]).find((c) => c.rule_kind === kind && c.status === status)?.n ?? 0;
    return {
      kind,
      enabled: row?.enabled ?? false,
      params: (row?.params ?? RULES[kind].defaults) as Record<string, number>,
      effectiveFrom: row ? row.effective_from.getTime() : 0,
      updatedBy: row?.updated_by ?? "",
      updatedAt: row ? row.updated_at.getTime() : 0,
      adopted: Boolean(row),
      open: n("open"),
      notified: n("notified"),
      disputed: n("disputed"),
      held: n("held"),
    };
  });
}

/** New settings take effect now: days and weeks already over are not judged again. */
export async function changeRule(actor: Actor, kind: RuleKind, params: Record<string, number>, enabled: boolean) {
  await authorize(actor, "rules.change", { action: "change", resource: "rules", detail: { kind, enabled, ...params } });
  await sql`insert into rules (kind, enabled, params, effective_from, updated_by, updated_at) values (${kind}, ${enabled}, ${sql.json(params)}, ${sqlNow()}, ${actor.name}, ${sqlNow()})
    on conflict (kind) do update set enabled = excluded.enabled, params = excluded.params, effective_from = excluded.effective_from, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
}
