// Who is told what, and when. Each seat is told only what it can act on, once:
// an alert is keyed by its subject, so running the planner again never repeats it.
// Alerts are grouped by case, outage or week, never one per finding. Pure.

import type { Role } from "./access";
import { caseReference, DUE_SOON_DAYS, dueDate, dueState, stepInfo, type CaseStatus, type EventKind } from "./cases";

export type AlertPerson = { userId: string; name: string; role: Role; operatorId: string | null };

export type CaseFact = {
  id: string;
  number: number;
  rule: string;
  operatorId: string;
  operatorName: string;
  /** The Monday of the case's week, as the reader should see it, e.g. "16 November". */
  week: string;
  status: CaseStatus;
  /** The rung the notice was recorded at; null before a notice. */
  step: number | null;
  /** The rung the next notice would land on. */
  nextStep: number;
  openedAt: number;
  dueAt: number | null;
  /** The operator has answered and the answer has not been dealt with. */
  replied: boolean;
  counted: number;
};
export type EventFact = { caseId: string; kind: EventKind; at: number; actorId: string | null };
/** One operator's feed trouble on one day: however often the feed dropped, it is one thing to know. */
export type OutageFact = { operatorId: string; operatorName: string; date: string; outages: number; minutes: number; at: number; /** Set while the feed is still not answering. */ downSince: number | null; held: number };
/** A feed that has been silent this long is worth interrupting someone for. */
export const FEED_DOWN_URGENT_MINUTES = 10;
export type HoldFact = { operatorId: string; operatorName: string; weekStart: string; week: string; count: number; at: number };
export type InvoiceFact = { id: string; number: string; operatorId: string; operatorName: string; period: string; flagged: boolean; generatedAt: number; issuedAt: number | null };
/** A rule or zone that changed. `by` is the name of whoever changed it, who is not told. */
export type ChangeFact = { key: string; at: number; by: string; title: string; body: string; href: string };

export type Alert = { userId: string; key: string; kind: string; at: number; title: string; body: string; href: string; operatorId: string | null; urgent: boolean };

export type AlertFacts = {
  now: number;
  people: AlertPerson[];
  cases: CaseFact[];
  events: EventFact[];
  outages: OutageFact[];
  holds: HoldFact[];
  invoices: InvoiceFact[];
  changes: ChangeFact[];
  /** Formats a date such as 2026-11-23 for a reader. */
  day: (date: string) => string;
};

const DAY_MS = 86_400_000;
/** "Kestrel Mobility's", "Pronghorn Rides'". */
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
/** A feed that missed fewer polls than this in a day is not worth a line in anyone's summary. */
export const FEED_DAY_MIN_MINUTES = 3;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function planAlerts(facts: AlertFacts): Alert[] {
  const { now, people, day } = facts;
  const out: Alert[] = [];
  const byRole = (...roles: Role[]) => people.filter((p) => roles.includes(p.role));
  const ofOperator = (operatorId: string) => people.filter((p) => p.role === "operator" && p.operatorId === operatorId);
  const tell = (to: AlertPerson[], alert: Omit<Alert, "userId" | "urgent"> & { urgent?: boolean }, except?: string | null) => {
    for (const p of to) if (p.userId !== except) out.push({ urgent: false, ...alert, userId: p.userId });
  };
  const cases = new Map(facts.cases.map((c) => [c.id, c]));

  for (const e of facts.events) {
    const c = cases.get(e.caseId);
    if (!c) continue;
    const ref = caseReference(c.number);
    const href = `/cases/${c.number}`;
    const base = { at: e.at, href, operatorId: c.operatorId };
    const due = c.dueAt === null ? null : day(dueDate(c.dueAt));
    switch (e.kind) {
      case "opened":
        if (c.status === "held") break;
        tell(byRole("analyst"), { ...base, key: `case.new:${c.id}`, kind: "case.new", title: `New case: ${c.operatorName}, ${c.rule.toLowerCase()}`, body: `${ref}, week of ${c.week}. Check the evidence and decide whether to record a notice.` });
        break;
      case "reply":
        tell(byRole("analyst"), { ...base, key: `case.reply:${c.id}:${e.at}`, kind: "case.reply", title: `${c.operatorName} replied on ${ref}`, body: `${c.rule}, week of ${c.week}. Read the reply, then close the case or follow up.` });
        break;
      case "dispute":
        tell(byRole("analyst", "program_manager"), { ...base, key: `case.dispute:${c.id}:${e.at}`, kind: "case.dispute", urgent: true, title: `${c.operatorName} disputes ${ref}`, body: `${c.rule}, week of ${c.week}. ${due ? `The city's decision is due by ${due}.` : "The city's decision is due."}` });
        break;
      case "notice":
        if (c.step !== null) tell(ofOperator(c.operatorId), { ...base, key: `op.notice:${c.id}`, kind: "op.notice", title: `Notice ${ref}: ${c.rule.toLowerCase()}`, body: `Week of ${c.week}. ${stepInfo(c.step).consequence}${c.status === "notified" && due ? ` Reply or dispute by ${due}.` : ""}` }, e.actorId);
        break;
      case "upheld":
        tell(ofOperator(c.operatorId), { ...base, key: `op.upheld:${c.id}:${e.at}`, kind: "op.decision", title: `The city has upheld ${ref}`, body: `Your dispute was considered and the notice stands.${c.status === "notified" && due ? ` Reply by ${due}.` : ""}` });
        break;
      case "withdrawn":
        tell(ofOperator(c.operatorId), { ...base, key: `op.withdrawn:${c.id}:${e.at}`, kind: "op.decision", title: `The city has withdrawn ${ref}`, body: "It no longer counts on your record and nothing more is needed." });
        break;
      case "follow_up":
        tell(ofOperator(c.operatorId), { ...base, key: `op.follow_up:${c.id}:${e.at}`, kind: "op.message", title: `The city has written to you about ${ref}`, body: `${c.rule}, week of ${c.week}.` });
        break;
      case "resolved":
        if (c.step !== null) tell(ofOperator(c.operatorId), { ...base, key: `op.resolved:${c.id}:${e.at}`, kind: "op.resolved", title: `${ref} is closed`, body: `${c.rule}, week of ${c.week}. The city has closed the case. The notice stays on your record.` });
        break;
      case "reopened":
        if (c.step !== null) tell(ofOperator(c.operatorId), { ...base, key: `op.reopened:${c.id}:${e.at}`, kind: "op.reopened", title: `The city has reopened ${ref}`, body: `${c.rule}, week of ${c.week}.` });
        break;
    }
  }

  for (const c of facts.cases) {
    const ref = caseReference(c.number);
    const base = { href: `/cases/${c.number}`, operatorId: c.operatorId };
    const state = dueState(c.dueAt, now);
    const due = c.dueAt === null ? "" : day(dueDate(c.dueAt));

    if (c.status === "notified" && !c.replied && c.dueAt !== null) {
      if (state === "soon") {
        const at = c.dueAt - DUE_SOON_DAYS * DAY_MS;
        tell(byRole("analyst"), { ...base, at, key: `case.due_soon:${c.id}:${c.dueAt}`, kind: "case.due_soon", title: `No reply yet on ${ref}, due ${due}`, body: `${c.operatorName}, ${c.rule.toLowerCase()}.` });
        tell(ofOperator(c.operatorId), { ...base, at, key: `op.due_soon:${c.id}:${c.dueAt}`, kind: "op.due_soon", title: `Your reply to ${ref} is due ${due}`, body: `${c.rule}, week of ${c.week}. Say what has been done, or dispute the finding.` });
      } else if (state === "overdue") {
        tell(byRole("analyst"), { ...base, at: c.dueAt, key: `case.overdue:${c.id}:${c.dueAt}`, kind: "case.overdue", urgent: true, title: `${c.operatorName} missed the reply date on ${ref}`, body: `${c.rule}, week of ${c.week}. A reply was due by ${due}.` });
        tell(ofOperator(c.operatorId), { ...base, at: c.dueAt, key: `op.overdue:${c.id}:${c.dueAt}`, kind: "op.overdue", title: `Your reply to ${ref} is overdue`, body: `It was due by ${due}. ${c.rule}, week of ${c.week}.` });
      }
    }
    if (c.status === "disputed" && c.dueAt !== null && state !== "ahead") {
      const late = state === "overdue";
      tell(byRole("analyst", "program_manager"), {
        ...base, at: late ? c.dueAt : c.dueAt - DUE_SOON_DAYS * DAY_MS, key: `case.decision_${late ? "late" : "soon"}:${c.id}:${c.dueAt}`, kind: "case.decision_due", urgent: late,
        title: late ? `The decision on ${ref} is overdue` : `Decide the dispute on ${ref} by ${due}`, body: `${c.operatorName} disputed the notice. ${c.rule}, week of ${c.week}.`,
      });
    }
    // The program manager hears about a case only when the next notice has a consequence that is theirs to weigh.
    if (c.status === "open" && c.counted > 0 && c.nextStep >= 3) {
      const info = stepInfo(c.nextStep);
      tell(byRole("program_manager"), {
        ...base, at: c.openedAt, key: `case.step:${c.id}`, kind: "case.step", urgent: info.needsProgramManager,
        title: `The next notice to ${c.operatorName} on ${c.rule.toLowerCase()} would be step ${info.step} of the ladder`,
        body: `${ref}, week of ${c.week}. The next notice carries: ${info.consequence.toLowerCase()}${info.needsProgramManager ? " Only the program manager can record it." : ""}`,
      });
    }
  }

  for (const o of facts.outages) {
    const held = o.held > 0 ? ` ${plural(o.held, "finding")} from that time ${o.held === 1 ? "is" : "are"} held.` : "";
    const base = { href: "/health", operatorId: o.operatorId };
    const when = day(o.date);
    // The day's trouble goes to the people who chase feeds. The program manager hears only when a feed is down now.
    if (o.minutes >= FEED_DAY_MIN_MINUTES) tell(byRole("analyst", "admin"), {
      ...base, at: o.at, key: `feed.day:${o.operatorId}:${o.date}`, kind: "feed.day",
      title: o.outages === 1 ? `${possessive(o.operatorName)} feed was down for ${plural(o.minutes, "minute")} on ${when}` : `${possessive(o.operatorName)} feed dropped ${o.outages} times on ${when}`,
      body: `${o.outages === 1 ? "One outage." : `${plural(o.minutes, "minute")} without an answer in all.`} Nothing is judged on a record with a gap in it.${held}`,
    });
    if (o.minutes >= FEED_DAY_MIN_MINUTES) tell(ofOperator(o.operatorId), {
      ...base, at: o.at, key: `op.feed:${o.operatorId}:${o.date}`, kind: "op.feed",
      title: o.outages === 1 ? `The city could not reach your feed for ${plural(o.minutes, "minute")} on ${when}` : `The city could not reach your feed ${o.outages} times on ${when}`,
      body: "Feed availability counts towards your data health score.",
    });
    if (o.downSince !== null && now - o.downSince >= FEED_DOWN_URGENT_MINUTES * 60_000) {
      tell(byRole("analyst", "program_manager", "admin"), {
        ...base, at: o.downSince, key: `feed.down:${o.operatorId}:${o.downSince}`, kind: "feed.down", urgent: true,
        title: `${possessive(o.operatorName)} feed is not answering`, body: `No answer for ${plural(Math.round((now - o.downSince) / 60_000), "minute")} so far. Findings made while it is down are held.${held}`,
      });
    }
  }

  for (const h of facts.holds) {
    tell(byRole("analyst", "program_manager"), {
      at: h.at, href: "/cases?status=held", operatorId: h.operatorId, key: `held:${h.operatorId}:${h.weekStart}`, kind: "held",
      title: `${plural(h.count, "finding")} held: ${h.operatorName}, week of ${h.week}`, body: "The data is not firm enough to put them to the operator. Each one says why, and can be released after a check.",
    });
  }

  for (const i of facts.invoices) {
    const base = { href: `/invoices/${i.number}`, operatorId: i.operatorId };
    if (i.issuedAt === null) {
      tell(byRole("finance"), {
        ...base, at: i.generatedAt, key: `invoice.ready:${i.id}`, kind: i.flagged ? "invoice.flagged" : "invoice.ready", urgent: i.flagged,
        title: i.flagged ? `${i.number} does not reconcile` : `${i.number} is ready to sign off`,
        body: i.flagged ? `${possessive(i.operatorName)} own count for ${i.period} disagrees with the city's by more than the tolerance. Look before signing off.` : `${i.operatorName}, ${i.period}. The operator's report agrees with the city's count.`,
      });
      if (i.flagged) tell(byRole("program_manager"), { ...base, at: i.generatedAt, key: `invoice.flagged:${i.id}`, kind: "invoice.flagged", title: `${possessive(i.operatorName)} ${i.period} report does not reconcile`, body: `${i.number} is with finance. The gap is larger than the tolerance in the fee schedule.` });
    } else {
      tell(ofOperator(i.operatorId), { ...base, at: i.issuedAt, key: `op.invoice:${i.id}`, kind: "op.invoice", title: `Invoice ${i.number} has been issued`, body: `${i.period}. The invoice and the trip ledger behind it can be downloaded.` });
    }
  }

  // A change to a rule or zone goes to the people who have to work with it, never back to whoever made it.
  for (const change of facts.changes) {
    for (const p of people) {
      if ((p.role !== "analyst" && p.role !== "operator") || p.name === change.by) continue;
      out.push({ userId: p.userId, key: change.key, kind: "change", at: change.at, title: change.title, body: change.body, href: change.href, operatorId: null, urgent: false });
    }
  }

  return out;
}

/** One message for everything that did not need saying at once. */
export function digest(name: string, alerts: { title: string; body: string; href: string }[], dayLabel: string): { subject: string; body: string } {
  const subject = alerts.length === 1 ? alerts[0]!.title : `${plural(alerts.length, "update")} for ${dayLabel}`;
  const lines = alerts.map((a, i) => `${i + 1}. ${a.title}\n   ${a.body}\n   ${a.href}`);
  return { subject, body: `${name},\n\nSince your last summary:\n\n${lines.join("\n\n")}\n\nThis summary is sent once a day. Anything urgent is sent as it happens.` };
}
