// The rule engine's run: reads the stored record, applies the city's rules as
// they stood, and files what it finds into cases: one case for each operator,
// rule and week. Safe to repeat: a finding is keyed by rule, operator, period
// and vehicle, so a second run refreshes its measurements and never duplicates
// it. A finding the data does not firmly support is held, with the reason.

import {
  assessCount, assessDwell, assessLag, assessSla, caseWeek, misparkMarginMeters, rejectedShare, restingStatus, type HoldReason,
  addDays, buildStays, capDay, dwellBreaches, equityCount, equityWeek, fleetAt, fleetCounts, localDate, misparked, RULE_KINDS, RULES, slaBreaches, SPEED_GAP, speedDay, startOfLocalDay, weekStart,
  type DwellEvidence, type EquityEvidence, type FleetCapEvidence, type MisparkReason, type RuleKind, type RuleParams, type RuleZone, type SlaEvidence, type SpeedPass, type StatusChange,
} from "@mm/core";
import type { Sql } from "@mm/db";
import { loadRuleZones } from "./context";

const HOUR_MS = 3_600_000;
/** A day's finding lists at most this many vehicles; the count is always complete. */
const SLA_VEHICLES_LISTED = 200;

export type Rule<K extends RuleKind = RuleKind> = { kind: K; enabled: boolean; params: RuleParams[K]; effectiveFrom: number };

type Finding = {
  kind: RuleKind;
  periodStart: number;
  periodEnd: number | null;
  subject: string;
  deviceId: string | null;
  measured: number;
  threshold: number;
  params: object;
  evidence: object;
  /** When the breach became knowable: the moment a deadline passed, or the end of the day or week judged. */
  at: number;
  /** Why the finding is held back, if the data does not support it firmly enough. Empty when it stands. */
  hold: HoldReason[];
};

const reasons = (...found: (HoldReason | null)[]) => found.filter((r): r is HoldReason => r !== null);

export async function loadRules(sql: Sql): Promise<{ [K in RuleKind]: Rule<K> }> {
  const rows = await sql`select kind, enabled, params, effective_from from rules`;
  const rule = <K extends RuleKind>(kind: K): Rule<K> => {
    const row = rows.find((r) => r.kind === kind);
    // A rule the city has never adopted does nothing.
    return row ? { kind, enabled: row.enabled, params: row.params, effectiveFrom: row.effective_from.getTime() } : { kind, enabled: false, params: RULES[kind].defaults, effectiveFrom: 0 };
  };
  return Object.fromEntries(RULE_KINDS.map((kind) => [kind, rule(kind)])) as { [K in RuleKind]: Rule<K> };
}

/** The local days that overlap [from, to), as dates with their start and end instants. */
function localDays(from: number, to: number): { date: string; start: number; end: number }[] {
  const days = [];
  for (let date = localDate(from); ; date = addDays(date, 1)) {
    const start = startOfLocalDay(date);
    if (start >= to) break;
    days.push({ date, start, end: startOfLocalDay(addDays(date, 1)) });
  }
  return days;
}

/**
 * Applies every enabled rule to the record between `from` and `to`. `to` is the moment of
 * evaluation: vehicles still parked are measured up to it, and days or weeks not yet over
 * at `to` are judged only by rules whose measure cannot fall again (the cap, the deadlines).
 */
export async function detectViolations(sql: Sql, window: { from: number; to: number }): Promise<{ found: number; created: number }> {
  const { to } = window;
  // Whole days and whole weeks are judged, so the record is read from the Monday before `from`.
  const from = startOfLocalDay(weekStart(localDate(window.from)));
  const rules = await loadRules(sql);
  const zones = await loadRuleZones(sql);
  const zoneNames = new Map(zones.map((z) => [z.id, z.name]));
  const operators = await sql`select id, name, ingested_through from operators order by name`;
  const permits = await sql`select operator_id, devices, start_date::text as start_date, end_date::text as end_date from permits`;
  const vehicles = new Map((await sql`select device_id, vehicle_code, vehicle_type from vehicles`).map((v) => [v.device_id as string, { code: v.vehicle_code as string, type: v.vehicle_type as string }]));
  const code = (deviceId: string) => vehicles.get(deviceId)?.code ?? deviceId.slice(0, 8);
  const days = localDays(from, to);

  let found = 0;
  let created = 0;
  for (const op of operators) {
    // Each vehicle's history from its last ride or collection before the window, so a vehicle that
    // has stood untouched for weeks is seen from the moment it was left there.
    const rows = await sql`
      with last_move as (
        select device_id, max(ts) as ts from status_events
        where operator_id = ${op.id} and ts < ${new Date(from)} and state in ('on_trip', 'removed') group by device_id
      )
      select e.device_id, e.ts, e.state, e.lng, e.lat from status_events e
      left join last_move m on m.device_id = e.device_id
      where e.operator_id = ${op.id} and e.ts <= ${new Date(to)} and (m.ts is null or e.ts >= m.ts)
      order by e.ts, e.event_id`;
    const events: StatusChange[] = rows.map((r) => ({ deviceId: r.device_id, ts: r.ts.getTime(), state: r.state, lng: r.lng, lat: r.lat }));
    const findings: Finding[] = [];
    // How much of the operator's status record had to be rejected, hour by hour, and how far the record reaches.
    const loss = (await sql`select period_hour, sum(record_count)::int as records, sum(invalid_count)::int as rejected from feed_polls
      where operator_id = ${op.id} and feed = 'mds.events_historical' and period_hour is not null group by 1`).map((r) => ({ hour: r.period_hour.getTime() as number, records: r.records as number, rejected: r.rejected as number }));
    const lost = (start: number, end: number) => rejectedShare(loss, start, end);
    const through: number | null = op.ingested_through ? op.ingested_through.getTime() : null;
    /** A period is judged by a rule only if it was still running when the rule's current settings were adopted. */
    const applies = (rule: Rule, periodEnd: number | null) => rule.enabled && (periodEnd === null || periodEnd > rule.effectiveFrom);

    // Fleet cap: one finding per day the fleet stayed over its permit.
    if (rules.fleet_cap.enabled) {
      const steps = fleetCounts(events);
      for (const day of days) {
        if (!applies(rules.fleet_cap, day.end)) continue;
        const permitted = permits.filter((p) => p.operator_id === op.id && p.start_date <= day.date && (p.end_date === null || p.end_date >= day.date)).reduce((sum, p) => sum + p.devices, 0);
        const { breachedAt, ...evidence } = capDay(steps, day, permitted, rules.fleet_cap.params.graceMinutes, to);
        if (breachedAt === null) continue;
        findings.push({ kind: "fleet_cap", periodStart: day.start, periodEnd: day.end, subject: "", deviceId: null, measured: evidence.peak, threshold: permitted, params: rules.fleet_cap.params, evidence: evidence satisfies FleetCapEvidence, at: breachedAt,
          hold: reasons(assessCount(evidence.peak, permitted, lost(day.start, Math.min(day.end, to))), assessLag(day.end, through, to)) });
      }
    }

    // Equity minimum: one finding per finished week whose average morning share fell short.
    if (rules.equity_minimum.enabled) {
      const { minSharePct, checkHour } = rules.equity_minimum.params;
      const equityZones = zones.filter((z) => z.type === "equity");
      const weeks = new Map<string, typeof days>();
      for (const day of days) weeks.set(weekStart(day.date), [...(weeks.get(weekStart(day.date)) ?? []), day]);
      const complete = [...weeks.values()].filter((week) => week.length === 7 && week[6]!.end <= to && applies(rules.equity_minimum, week[6]!.end));
      const times = complete.flat().map((day) => day.start + checkHour * HOUR_MS);
      const snapshots = fleetAt(events, times);
      complete.forEach((week, w) => {
        const counted = week.map((day, d) => ({ date: day.date, ...equityCount(snapshots[w * 7 + d]!.values(), equityZones, times[w * 7 + d]!) }));
        const result = equityWeek(counted);
        const inForce = equityZones.filter((z) => z.effectiveFrom < week[6]!.end && (z.retiredAt === null || z.retiredAt > week[0]!.start));
        // With no equity zone drawn there is nothing to be short of.
        if (!result || inForce.length === 0 || result.sharePct >= minSharePct) return;
        const evidence: EquityEvidence = { checkHour, days: result.days, zones: inForce.map((z) => z.name) };
        findings.push({ kind: "equity_minimum", periodStart: week[0]!.start, periodEnd: week[6]!.end, subject: "", deviceId: null, measured: result.sharePct, threshold: minSharePct, params: rules.equity_minimum.params, evidence, at: week[6]!.end,
          hold: reasons(assessCount(result.sharePct, minSharePct, lost(week[0]!.start, week[6]!.end))) });
      });
    }

    const stays = rules.parking_dwell.enabled || rules.rebalancing_sla.enabled ? buildStays(events).filter((stay) => (stay.to ?? to) >= from) : [];

    // Parking dwell: one finding per vehicle left in one spot past the limit.
    if (rules.parking_dwell.enabled) {
      for (const { stay, breachAt, hours } of dwellBreaches(stays, rules.parking_dwell.params.limitHours, to)) {
        if (!applies(rules.parking_dwell, stay.to)) continue;
        const where = misparked(stay, zones);
        const evidence: DwellEvidence = {
          code: code(stay.deviceId), vehicleType: vehicles.get(stay.deviceId)?.type ?? "unknown", lng: stay.lng, lat: stay.lat,
          parkedAt: stay.from, movedAt: stay.to, hours, lastState: stay.lastState, misparked: where?.reason ?? null, zone: where?.zone ?? null,
        };
        findings.push({ kind: "parking_dwell", periodStart: stay.from, periodEnd: stay.to, subject: stay.deviceId, deviceId: stay.deviceId, measured: hours, threshold: rules.parking_dwell.params.limitHours, params: rules.parking_dwell.params, evidence, at: breachAt,
          hold: reasons(assessDwell(lost(stay.from, stay.to ?? to)), assessLag(stay.to, through, to)) });
      }
    }

    // Rebalancing deadline: one finding per day on which more deadlines were missed than the rule tolerates.
    if (rules.rebalancing_sla.enabled) {
      const { hours, dailyAllowance } = rules.rebalancing_sla.params;
      const breaches = slaBreaches(stays, zones, hours, to);
      for (const day of days) {
        if (!applies(rules.rebalancing_sla, day.end)) continue;
        const missed = breaches.filter((b) => b.breachAt >= day.start && b.breachAt < day.end).sort((a, b) => a.breachAt - b.breachAt);
        if (missed.length <= dailyAllowance) continue;
        const byReason: Record<MisparkReason, number> = { outside_area: 0, no_ride: 0, no_parking: 0 };
        for (const b of missed) byReason[b.reason]++;
        const evidence: SlaEvidence = {
          hours,
          total: missed.length,
          byReason,
          vehicles: [...missed].sort((a, b) => b.hours - a.hours).slice(0, SLA_VEHICLES_LISTED).map((b) => ({
            deviceId: b.stay.deviceId, code: code(b.stay.deviceId), reason: b.reason, zone: b.zone, lng: b.stay.lng, lat: b.stay.lat, parkedAt: b.stay.from, movedAt: b.stay.to, hours: b.hours,
          })),
        };
        findings.push({ kind: "rebalancing_sla", periodStart: day.start, periodEnd: day.end, subject: "", deviceId: null, measured: missed.length, threshold: dailyAllowance, params: rules.rebalancing_sla.params, evidence, at: missed[dailyAllowance]!.breachAt,
          hold: reasons(assessSla(missed.map((b) => misparkMarginMeters(b.stay, b.reason, zones)), dailyAllowance), assessLag(day.end, through, to)) });
      }
    }

    // Slow zones: one finding per finished day on which too large a share of rides went through over the limit.
    if (rules.slow_zone_speed.enabled) {
      const { toleranceKph, maxSharePct } = rules.slow_zone_speed.params;
      const finished = days.filter((day) => day.end <= to && applies(rules.slow_zone_speed, day.end));
      if (finished.length > 0) {
        const stored = await sql`select trip_id, zone_id, device_id, entered_at, limit_kph, speeds from zone_passes
          where operator_id = ${op.id} and entered_at >= ${new Date(finished[0]!.start)} and entered_at < ${new Date(finished[finished.length - 1]!.end)} order by entered_at`;
        const passes: SpeedPass[] = stored.map((r) => ({
          tripId: r.trip_id, deviceId: r.device_id, zoneId: r.zone_id, enteredAt: r.entered_at.getTime(), limitKph: r.limit_kph,
          speeds: (r.speeds as number[]).map((s) => (s < 0 ? SPEED_GAP : s / 10)),
        }));
        for (const day of finished) {
          const result = speedDay(passes.filter((p) => p.enteredAt >= day.start && p.enteredAt < day.end), toleranceKph);
          if (!result || result.sharePct <= maxSharePct) continue;
          const { sharePct, ...counts } = result;
          const evidence = {
            ...counts,
            zones: counts.zones.map((z) => ({ ...z, name: zoneNames.get(z.zoneId) ?? "Retired zone" })),
            worst: counts.worst.map((w) => ({ ...w, code: code(w.deviceId), zone: zoneNames.get(w.zoneId) ?? "Retired zone" })),
          };
          findings.push({ kind: "slow_zone_speed", periodStart: day.start, periodEnd: day.end, subject: "", deviceId: null, measured: sharePct, threshold: maxSharePct, params: rules.slow_zone_speed.params, evidence, at: day.end, hold: [] });
        }
      }
    }

    found += findings.length;
    created += await file(sql, op.id, findings, to);
  }
  return { found, created };
}

const ENGINE = "Rule engine";

/**
 * Writes findings into their cases. A finding already on file keeps its history and the time it was first
 * detected; once staff have ruled on it, or its case has gone to the operator, its standing is left alone.
 */
async function file(sql: Sql, operatorId: string, findings: Finding[], now: number): Promise<number> {
  if (findings.length === 0) return 0;

  // One case per rule and week. A case opens at the moment its first finding became knowable.
  const opened = new Map<string, { rule_kind: string; operator_id: string; week_start: string; status: string; opened_at: Date }>();
  for (const f of findings) {
    const key = `${f.kind}|${caseWeek(f.periodStart)}`;
    const at = Math.min(f.at, now);
    const seen = opened.get(key);
    if (!seen || at < seen.opened_at.getTime()) opened.set(key, { rule_kind: f.kind, operator_id: operatorId, week_start: caseWeek(f.periodStart), status: "open", opened_at: new Date(at) });
  }
  const born = await sql`insert into cases ${sql([...opened.values()])} on conflict (rule_kind, operator_id, week_start) do nothing returning id, opened_at`;
  if (born.length > 0) await sql`insert into case_events ${sql(born.map((c) => ({ case_id: c.id, at: c.opened_at, actor_name: ENGINE, kind: "opened", note: "Opened by the rule engine on the week's first finding." })))}`;
  const existing = await sql`select id, rule_kind, week_start::text as week_start, status from cases where operator_id = ${operatorId}`;
  const caseOf = new Map(existing.map((c) => [`${c.rule_kind}|${c.week_start}`, c]));
  const newlyBorn = new Set(born.map((c) => c.id as string));

  let created = 0;
  const added = new Map<string, number>();
  for (let i = 0; i < findings.length; i += 500) {
    const rows = findings.slice(i, i + 500).map((f) => ({
      case_id: caseOf.get(`${f.kind}|${caseWeek(f.periodStart)}`)!.id,
      rule_kind: f.kind,
      operator_id: operatorId,
      period_start: new Date(f.periodStart),
      period_end: f.periodEnd === null ? null : new Date(f.periodEnd),
      subject: f.subject,
      device_id: f.deviceId,
      measured: f.measured,
      threshold: f.threshold,
      rule_params: sql.json(f.params as never),
      evidence: sql.json(f.evidence as never),
      standing: f.hold.length > 0 ? "held" : "counted",
      hold: f.hold.length > 0 ? sql.json(f.hold as never) : null,
      detected_at: new Date(Math.min(f.at, now)),
      last_evaluated_at: new Date(now),
    }));
    const written = await sql`
      insert into violations as v ${sql(rows as never)}
      on conflict (rule_kind, operator_id, period_start, subject) do update set
        period_end = excluded.period_end, measured = excluded.measured, threshold = excluded.threshold,
        rule_params = excluded.rule_params, evidence = excluded.evidence, last_evaluated_at = excluded.last_evaluated_at,
        standing = case when v.standing_by is null and (select status from cases where id = v.case_id) in ('held', 'open') then excluded.standing else v.standing end,
        hold = case when v.standing_by is null and (select status from cases where id = v.case_id) in ('held', 'open') then excluded.hold else v.hold end
      returning case_id, (xmax = 0) as inserted`;
    for (const r of written) if (r.inserted) added.set(r.case_id, (added.get(r.case_id) ?? 0) + 1);
    created += written.filter((r) => r.inserted).length;
  }

  // A finding that arrives after a case has moved on is noted on the case; one that arrives after it was closed reopens it.
  const late = existing.filter((c) => added.has(c.id) && !newlyBorn.has(c.id) && ["notified", "disputed", "resolved"].includes(c.status));
  for (const c of late) {
    const n = added.get(c.id)!;
    const what = `${n} new finding${n === 1 ? "" : "s"}`;
    if (c.status === "resolved") {
      await sql`update cases set status = 'open', outcome = null, due_at = null, replied_at = null, status_changed_at = ${new Date(now)}, status_changed_by = ${ENGINE} where id = ${c.id}`;
      await sql`insert into case_events ${sql({ case_id: c.id, at: new Date(now), actor_name: ENGINE, kind: "reopened", note: `${what} in the same week after the case was closed.` })}`;
    } else {
      await sql`insert into case_events ${sql({ case_id: c.id, at: new Date(now), actor_name: ENGINE, kind: "finding", note: `${what} added after the notice. The reply date has not moved.` })}`;
    }
  }

  // A case with nothing firm in it waits in the held pile; the first firm finding puts it in the queue.
  const resting = await sql`select c.id, c.status, count(*) filter (where v.standing = 'counted')::int as counted, count(*) filter (where v.standing = 'held')::int as held
    from cases c join violations v on v.case_id = c.id where c.operator_id = ${operatorId} and c.status in ('held', 'open') group by c.id`;
  for (const c of resting) {
    const status = restingStatus(c.counted, c.held);
    if (status === c.status) continue;
    await sql`update cases set status = ${status} where id = ${c.id}`;
    if (status === "open" && !newlyBorn.has(c.id)) {
      await sql`insert into case_events ${sql({ case_id: c.id, at: new Date(now), actor_name: ENGINE, kind: "opened", note: "A firm finding was added, so the case has moved from held into the queue." })}`;
    }
  }
  return created;
}
