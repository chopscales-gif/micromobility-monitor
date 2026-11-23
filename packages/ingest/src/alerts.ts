// Gathers what the alert planner needs to know, files what it decides, and writes
// the email each alert would have produced to the outbox. Nothing is ever sent:
// the outbox is the demonstration's stand-in for a mail server.

import { clock } from "@mm/core/clock";
import {
  digest, ladderStep, localDate, localHour, monthLabel, planAlerts, RULES, ZONE_LABELS,
  type Alert, type AlertPerson, type CaseFact, type ChangeFact, type HoldFact, type InvoiceFact, type OutageFact, type RuleKind, type ZoneType,
} from "@mm/core";
import type { Sql } from "@mm/db";

const DAY_MS = 86_400_000;
/** Events older than this are history, not news. */
const NEWS_DAYS = 7;
/** Failed polls less than this far apart are one outage. */
const OUTAGE_GAP_MS = 30 * 60_000;
/** The daily summary goes out at this hour of the city's morning. */
export const DIGEST_HOUR = 7;

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" });
/** "2026-11-23" to "Nov 23". */
const day = (date: string) => DAY_FORMAT.format(Date.parse(`${date}T00:00:00Z`));

async function gather(sql: Sql, now: number) {
  const since = new Date(now - NEWS_DAYS * DAY_MS);
  const [users, caseRows, eventRows, failed, holdRows, invoiceRows, ruleRows, zoneRows] = await Promise.all([
    sql`select id, name, role, operator_id from users`,
    sql`select c.id, c.number, c.rule_kind, c.operator_id, o.name, c.week_start::text as week_start, c.status, c.step, c.opened_at, c.due_at, c.replied_at,
        (select count(*)::int from violations v where v.case_id = c.id and v.standing = 'counted') as counted,
        (select count(*)::int from cases p where p.operator_id = c.operator_id and p.rule_kind = c.rule_kind and p.notified_at is not null and p.outcome is distinct from 'withdrawn'
          and p.week_start < c.week_start and p.week_start >= c.week_start - interval '12 months') as prior
      from cases c join operators o on o.id = c.operator_id
      where c.status <> 'resolved' or c.status_changed_at >= ${since}`,
    sql`select case_id, kind, at, actor_id from case_events where at >= ${since} and at <= ${new Date(now)} order by at`,
    sql`select f.operator_id, o.name, f.polled_at from feed_polls f join operators o on o.id = f.operator_id
      where f.outcome = 'http_error' and f.period_hour is null and f.polled_at >= ${since} and f.polled_at <= ${new Date(now)} order by f.operator_id, f.polled_at`,
    sql`select v.operator_id, o.name, c.week_start::text as week_start, count(*)::int as n, max(v.detected_at) as at
      from violations v join cases c on c.id = v.case_id join operators o on o.id = v.operator_id
      where v.standing = 'held' and c.status in ('held', 'open') group by 1, 2, 3 having max(v.detected_at) >= ${since}`,
    sql`select i.id, i.number, i.operator_id, o.name, i.year, i.month, i.flagged, i.generated_at, i.issued_at from invoices i join operators o on o.id = i.operator_id
      where i.issued_at is null or i.issued_at >= ${since}`,
    sql`select kind, enabled, updated_by, updated_at from rules where updated_at >= ${since}`,
    sql`select id, name, type, created_by, created_at, retired_at, retired_by from zones where (created_at >= ${since} and source <> 'seed') or retired_at >= ${since}`,
  ]);

  const people: AlertPerson[] = users.map((u) => ({ userId: u.id, name: u.name, role: u.role, operatorId: u.operator_id }));
  const cases: CaseFact[] = caseRows.map((c) => ({
    id: c.id, number: Number(c.number), rule: RULES[c.rule_kind as RuleKind].label, operatorId: c.operator_id, operatorName: c.name, week: day(c.week_start), status: c.status, step: c.step,
    nextStep: ladderStep(c.prior).step, openedAt: c.opened_at.getTime(), dueAt: c.due_at ? c.due_at.getTime() : null, replied: c.replied_at !== null, counted: c.counted,
  }));

  // One line per operator and day, however many times the feed dropped that day.
  const days = new Map<string, OutageFact & { last: number; minutesSeen: Set<number>; runStart: number }>();
  for (const f of failed) {
    const at = f.polled_at.getTime() as number;
    const date = localDate(at);
    const key = `${f.operator_id}|${date}`;
    let d = days.get(key);
    if (!d) days.set(key, (d = { operatorId: f.operator_id, operatorName: f.name, date, outages: 0, minutes: 0, at, downSince: null, held: 0, last: -Infinity, minutesSeen: new Set(), runStart: at }));
    if (at - d.last > OUTAGE_GAP_MS) {
      d.outages++;
      d.runStart = at;
    }
    d.last = at;
    d.minutesSeen.add(Math.floor(at / 60_000));
  }
  const lastPolls = await sql`select distinct on (operator_id) operator_id, polled_at, outcome from feed_polls where period_hour is null and polled_at <= ${new Date(now)} and polled_at >= ${new Date(now - DAY_MS)} order by operator_id, polled_at desc`;
  const heldByDay = await sql`select operator_id, detected_at from violations where standing = 'held' and detected_at >= ${since} and hold @> '[{"code":"record_behind"}]'`;
  const outages: OutageFact[] = [...days.values()].map((d) => {
    const lastPoll = lastPolls.find((p) => p.operator_id === d.operatorId);
    const stillDown = lastPoll?.outcome === "http_error" && lastPoll.polled_at.getTime() === d.last;
    return {
      operatorId: d.operatorId, operatorName: d.operatorName, date: d.date, outages: d.outages, minutes: d.minutesSeen.size, at: d.last, downSince: stillDown ? d.runStart : null,
      held: heldByDay.filter((h) => h.operator_id === d.operatorId && localDate(h.detected_at.getTime()) === d.date).length,
    };
  });

  const holds: HoldFact[] = holdRows.map((h) => ({ operatorId: h.operator_id, operatorName: h.name, weekStart: h.week_start, week: day(h.week_start), count: h.n, at: h.at.getTime() }));
  const invoices: InvoiceFact[] = invoiceRows.map((i) => ({
    id: i.id, number: i.number, operatorId: i.operator_id, operatorName: i.name, period: monthLabel(i.year, i.month), flagged: i.flagged, generatedAt: i.generated_at.getTime(), issuedAt: i.issued_at ? i.issued_at.getTime() : null,
  }));

  const changes: ChangeFact[] = [];
  for (const r of ruleRows) {
    const label = RULES[r.kind as RuleKind].label;
    changes.push({ key: `rule.changed:${r.kind}:${r.updated_at.getTime()}`, at: r.updated_at.getTime(), by: r.updated_by, title: `Rule changed: ${label.toLowerCase()}`, body: `${r.enabled ? "New settings are in force from now." : "The rule has been switched off."} Days and weeks already over are not judged again.`, href: "/rules" });
  }
  for (const z of zoneRows) {
    const kind = ZONE_LABELS[z.type as ZoneType].toLowerCase();
    if (z.created_at.getTime() >= since.getTime()) changes.push({ key: `zone.changed:${z.id}:created`, at: z.created_at.getTime(), by: z.created_by ?? "", title: `New ${kind}: ${z.name}`, body: "In force from the moment it was adopted. It is on the zones map.", href: "/zones" });
    if (z.retired_at && z.retired_at.getTime() >= since.getTime()) changes.push({ key: `zone.changed:${z.id}:retired`, at: z.retired_at.getTime(), by: z.retired_by ?? "", title: `Zone retired: ${z.name}`, body: `This ${kind} no longer applies. Findings already made against it stand.`, href: "/zones" });
  }

  return { now, people, cases, events: eventRows.map((e) => ({ caseId: e.case_id as string, kind: e.kind, at: e.at.getTime() as number, actorId: e.actor_id as string | null })), outages, holds, invoices, changes, day };
}

/**
 * Raises whatever alerts the present state calls for. Safe to repeat: an alert is keyed by its subject, so the same
 * thing is never raised twice. Urgent alerts to staff are written to the outbox at once; the rest wait for the daily summary.
 */
export async function raiseAlerts(sql: Sql, now = clock()): Promise<number> {
  const facts = await gather(sql, now);
  const planned: Alert[] = planAlerts(facts);
  if (planned.length === 0) return 0;
  const rows = planned.map((a) => ({ user_id: a.userId, key: a.key, kind: a.kind, at: new Date(Math.min(a.at, now)), title: a.title, body: a.body, href: a.href, operator_id: a.operatorId, urgent: a.urgent }));
  let raised = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await sql`insert into alerts ${sql(rows.slice(i, i + 500))} on conflict (user_id, key) do nothing returning id, user_id, at, title, body, href, urgent`;
    raised += inserted.length;
    const urgent = inserted.filter((a) => a.urgent);
    if (urgent.length === 0) continue;
    const users = await sql`select id, name, email from users where id in ${sql(urgent.map((a) => a.user_id))}`;
    const mail = urgent.map((a) => {
      const u = users.find((x) => x.id === a.user_id)!;
      return { at: a.at, to_user_id: u.id, to_name: u.name, to_email: u.email, kind: "alert", subject: a.title, body: `${u.name},\n\n${a.body}\n\n${a.href}\n\nSent at once because it may not wait for the daily summary.` };
    });
    await sql`insert into outbox ${sql(mail)}`;
    await sql`update alerts set emailed_at = at where id in ${sql(urgent.map((a) => a.id))}`;
  }
  return raised;
}

/** Writes the daily summary for everyone who has something waiting, once a day, after the summary hour. */
export async function sendDigests(sql: Sql, now = clock()): Promise<number> {
  if (localHour(now) < DIGEST_HOUR) return 0;
  const today = localDate(now);
  const waiting = await sql`select a.id, a.user_id, a.at, a.title, a.body, a.href, u.name, u.email from alerts a join users u on u.id = a.user_id
    where a.emailed_at is null and a.at <= ${new Date(now)} order by a.user_id, a.at`;
  const sentToday = new Set((await sql`select to_user_id, at from outbox where kind = 'digest' and at >= ${new Date(now - 2 * DAY_MS)}`).filter((o) => localDate(o.at.getTime()) === today).map((o) => o.to_user_id as string));
  const byUser = new Map<string, typeof waiting>();
  for (const a of waiting) if (!sentToday.has(a.user_id)) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a] as never);
  for (const [userId, alerts] of byUser) {
    const first = alerts[0]!;
    const { subject, body } = digest(first.name, alerts.map((a) => ({ title: a.title, body: a.body, href: a.href })), day(today));
    await sql`insert into outbox ${sql({ at: new Date(now), to_user_id: userId, to_name: first.name, to_email: first.email, kind: "digest", subject, body })}`;
    await sql`update alerts set emailed_at = ${new Date(now)} where id in ${sql(alerts.map((a) => a.id))}`;
  }
  return byUser.size;
}

