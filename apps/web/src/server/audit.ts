import type { Actor } from "@mm/core/access";
import { authorize } from "./guard";
import { sql } from "./db";

export type AuditEntry = {
  id: number;
  at: number;
  userName: string;
  role: string;
  action: string;
  resource: string;
  operatorName: string | null;
  allowed: boolean;
  detail: Record<string, unknown> | null;
};

export async function auditTrail(actor: Actor, filter: { only?: "refused" | "export" | "change" | null }): Promise<{ entries: AuditEntry[]; total: number; refused: number }> {
  await authorize(actor, "audit.view", { action: "read", resource: "audit_log" });
  const where = filter.only === "refused" ? sql`not a.allowed` : filter.only === "export" ? sql`a.action = 'export'` : filter.only === "change" ? sql`a.action = 'change'` : sql`true`;
  const [rows, [totals]] = await Promise.all([
    sql`select a.id, a.at, a.user_name, a.role, a.action, a.resource, o.name as operator_name, a.allowed, a.detail
      from audit_log a left join operators o on o.id = a.operator_id where ${where} order by a.id desc limit 200`,
    sql`select count(*)::int as total, count(*) filter (where not allowed)::int as refused from audit_log`,
  ]);
  return {
    total: totals!.total,
    refused: totals!.refused,
    entries: rows.map((r) => ({ id: Number(r.id), at: r.at.getTime(), userName: r.user_name, role: r.role, action: r.action, resource: r.resource, operatorName: r.operator_name, allowed: r.allowed, detail: r.detail })),
  };
}
