// Where an operator stands on each rule: the notices that count against it, the rung the next
// one would land on, and how its fleet measures against the rules at this moment.
//
// Built only from what has been put to the operator. A case the city has not recorded a notice
// on is the city's working material and plays no part here, whoever is looking.

import type { Actor } from "@mm/core/access";
import { caseReference, ladderStep, LADDER_WINDOW_MONTHS, type CaseOutcome, type CaseStatus } from "@mm/core/cases";
import { localDate } from "@mm/core/city";
import { equityCount, ON_STREET_STATES, PARKED_STATES, RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { loadRuleZones } from "@mm/ingest/context";
import { authorize } from "./guard";
import { sql } from "./db";

const HOUR_MS = 3_600_000;
/** A vehicle is "nearing" the dwell limit once it has stood for this share of it. */
export const DWELL_WARNING_SHARE = 2 / 3;

export type StandingNotice = { number: number; ref: string; week: string; step: number; status: CaseStatus; outcome: CaseOutcome | null; /** False for a notice the city withdrew. */ counts: boolean };

export type RuleStanding = {
  kind: RuleKind;
  enabled: boolean;
  params: Record<string, number>;
  /** Notices in the window that were not withdrawn. */
  counted: number;
  /** The rung a further notice on this rule would land on. */
  next: number;
  /** The day the oldest counted notice leaves the window, and the count falls by one. */
  easesOn: string | null;
  /** Every notice in the window, newest first, withdrawn ones included. */
  notices: StandingNotice[];
};

export type FleetNow = {
  /** When the operator's vehicle status was last read. Null if it never has been. */
  asOf: number | null;
  onStreet: number;
  permitted: number;
  /** Vehicles a rider could rent now, and how many of them stand in an equity zone. */
  available: number;
  inEquity: number;
  equityZones: number;
  /** Parked vehicles with no status change for two thirds of the dwell limit, and for all of it. */
  nearingDwell: number;
  pastDwell: number;
  dwellWarningHours: number;
};

export type OperatorStanding = { operatorId: string; slug: string; name: string; rules: RuleStanding[]; now: FleetNow };

/** Each operator's standing against the rules. An operator is given its own and no other. */
export async function standing(actor: Actor, now = Date.now()): Promise<OperatorStanding[]> {
  const scope = await authorize(actor, "violations.view", { action: "read", resource: "standing" });
  const mine = (column: string) => (scope ? sql`${sql(column)} = ${scope}` : sql`true`);
  const today = localDate(now);
  const [operators, ruleRows, notices, permits, vehicles, zones] = await Promise.all([
    sql`select id, slug, name from operators where ${mine("id")} order by name`,
    sql`select kind, enabled, params from rules`,
    sql`select operator_id, number, rule_kind, week_start::text as week, (week_start + ${`${LADDER_WINDOW_MONTHS} months`}::interval)::date::text as leaves, step, status, outcome from cases
      where notified_at is not null and week_start >= ${today}::date - ${`${LADDER_WINDOW_MONTHS} months`}::interval and ${mine("operator_id")}
      order by week_start desc, number desc`,
    sql`select operator_id, sum(devices)::int as devices from permits where start_date <= ${today}::date and (end_date is null or end_date >= ${today}::date) and ${mine("operator_id")} group by 1`,
    sql`select operator_id, device_id, state, lng, lat, event_time, updated_at from vehicle_status where ${mine("operator_id")}`,
    loadRuleZones(sql),
  ]);
  const equityZones = zones.filter((z) => z.type === "equity" && z.effectiveFrom <= now && (z.retiredAt === null || z.retiredAt > now));
  const onStreet = new Set<string>(ON_STREET_STATES);
  const parked = new Set<string>(PARKED_STATES);

  return operators.map((o) => {
    const rules = RULE_KINDS.map((kind): RuleStanding => {
      const row = ruleRows.find((r) => r.kind === kind);
      const own = notices.filter((n) => n.operator_id === o.id && n.rule_kind === kind);
      const counting = own.filter((n) => n.outcome !== "withdrawn");
      return {
        kind,
        enabled: row?.enabled ?? false,
        params: (row?.params ?? RULES[kind].defaults) as Record<string, number>,
        counted: counting.length,
        next: ladderStep(counting.length).step,
        easesOn: counting.at(-1)?.leaves ?? null,
        notices: own.map((n) => ({ number: Number(n.number), ref: caseReference(Number(n.number)), week: n.week, step: n.step, status: n.status, outcome: n.outcome, counts: n.outcome !== "withdrawn" })),
      };
    });

    const fleet = vehicles.filter((v) => v.operator_id === o.id);
    const limitHours = rules.find((r) => r.kind === "parking_dwell")!.params.limitHours!;
    const stood = (v: (typeof fleet)[number]) => (parked.has(v.state) ? (now - v.event_time.getTime()) / HOUR_MS : 0);
    const equity = equityCount(
      fleet.map((v) => ({ deviceId: v.device_id as string, ts: now, state: v.state as string, lng: v.lng as number, lat: v.lat as number })),
      equityZones,
      now,
    );
    return {
      operatorId: o.id,
      slug: o.slug,
      name: o.name,
      rules,
      now: {
        asOf: fleet.length > 0 ? Math.max(...fleet.map((v) => v.updated_at.getTime())) : null,
        onStreet: fleet.filter((v) => onStreet.has(v.state)).length,
        permitted: permits.find((p) => p.operator_id === o.id)?.devices ?? 0,
        available: equity.available,
        inEquity: equity.inZones,
        equityZones: equityZones.length,
        nearingDwell: fleet.filter((v) => stood(v) >= limitHours * DWELL_WARNING_SHARE && stood(v) < limitHours).length,
        pastDwell: fleet.filter((v) => stood(v) >= limitHours).length,
        dwellWarningHours: Math.round(limitHours * DWELL_WARNING_SHARE),
      },
    };
  });
}
