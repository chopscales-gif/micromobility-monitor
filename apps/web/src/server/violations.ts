// One finding and the evidence behind it. Findings are worked inside their case: see ./cases.

import type { Actor } from "@mm/core/access";
import { caseReference, type CaseStatus, type Standing } from "@mm/core/cases";
import type { HoldReason } from "@mm/core/confidence";
import type { RuleKind } from "@mm/core/rules";
import { reference } from "@/lib/violations";
import { authorize } from "./guard";
import { sql } from "./db";

export type Violation = {
  id: string;
  number: number;
  ref: string;
  kind: RuleKind;
  operator: string;
  operatorName: string;
  operatorId: string;
  periodStart: number;
  periodEnd: number | null;
  measured: number;
  threshold: number;
  params: unknown;
  evidence: unknown;
  standing: Standing;
  hold: HoldReason[];
  standingBy: string | null;
  standingAt: number | null;
  standingNote: string | null;
  detectedAt: number;
  lastEvaluatedAt: number;
  case: { number: number; ref: string; status: CaseStatus; week: string; step: number | null };
};

/**
 * City staff see every finding. An operator sees a finding of its own once the case has gone to it
 * with a notice, and never one the city is still checking.
 */
export async function violationDetail(actor: Actor, number: number) {
  const isOperator = actor.role === "operator";
  const [r] = await sql`select v.*, o.slug, o.name, c.number as case_number, c.status as case_status, c.week_start::text as week, c.step
    from violations v join operators o on o.id = v.operator_id join cases c on c.id = v.case_id
    where v.number = ${number} and ${isOperator ? sql`v.operator_id = ${actor.operatorId} and c.notified_at is not null and v.standing <> 'held'` : sql`true`}`;
  if (!r) {
    await authorize(actor, "violations.view", { action: "read", resource: "finding", detail: { number: reference(number), found: false }, withheld: true });
    return null;
  }
  await authorize(actor, "violations.view", { action: "read", resource: "finding", operatorId: r.operator_id, detail: { number: reference(number) } });
  const [zones, [rule]] = await Promise.all([
    sql`select name, type, speed_limit_kph, st_asgeojson(geom)::json as shape from zones where effective_from <= ${r.period_start} and (retired_at is null or retired_at > ${r.period_start})`,
    sql`select params, enabled from rules where kind = ${r.rule_kind}`,
  ]);
  const finding: Violation = {
    id: r.id, number: Number(r.number), ref: reference(Number(r.number)), kind: r.rule_kind, operator: r.slug, operatorName: r.name, operatorId: r.operator_id,
    periodStart: r.period_start.getTime(), periodEnd: r.period_end ? r.period_end.getTime() : null, measured: r.measured, threshold: r.threshold, params: r.rule_params, evidence: r.evidence,
    standing: r.standing, hold: (r.hold ?? []) as HoldReason[], standingBy: r.standing_by, standingAt: r.standing_at ? r.standing_at.getTime() : null, standingNote: isOperator ? null : r.standing_note,
    detectedAt: r.detected_at.getTime(), lastEvaluatedAt: r.last_evaluated_at.getTime(),
    case: { number: Number(r.case_number), ref: caseReference(Number(r.case_number)), status: r.case_status, week: r.week, step: r.step },
  };
  return {
    ...finding,
    zones: {
      type: "FeatureCollection" as const,
      features: zones.map((z) => ({ type: "Feature" as const, geometry: z.shape, properties: { name: z.name, type: z.type, speedLimitKph: z.speed_limit_kph } })),
    },
    ruleNow: rule ? { params: rule.params as unknown, enabled: rule.enabled as boolean } : null,
  };
}
