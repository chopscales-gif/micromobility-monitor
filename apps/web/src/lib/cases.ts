// The words the case screens use: one label and colour per status, one sentence per step.

import { dueDate, dueState, stepInfo, type CaseOutcome, type CaseStatus, type EventKind } from "@mm/core/cases";
import { RULES, type RuleKind } from "@mm/core/rules";
import { plainDay, plainShort } from "./format";

export const CASE_STATUSES: Record<CaseStatus, { label: string; hint: string; color: string }> = {
  open: { label: "To notify", hint: "Firm findings, and the operator has not been told yet", color: "var(--color-poor)" },
  notified: { label: "Notified", hint: "Notice recorded. The operator's clock is running", color: "var(--color-fair)" },
  disputed: { label: "Disputed", hint: "The operator says the finding is wrong. The city's clock is running", color: "var(--color-disputed)" },
  held: { label: "Held", hint: "Every finding is waiting on a check of the data. Nothing has gone to the operator", color: "var(--color-held)" },
  resolved: { label: "Closed", hint: "Finished, with a note saying how", color: "var(--color-good)" },
};
export const isCaseStatus = (value: unknown): value is CaseStatus => typeof value === "string" && value in CASE_STATUSES;

export const OUTCOMES: Record<CaseOutcome, string> = {
  corrected: "Put right by the operator",
  withdrawn: "Withdrawn by the city",
  closed: "Closed without a notice",
};

export const EVENTS: Record<EventKind, { label: string; color: string }> = {
  opened: { label: "Case opened", color: "var(--color-dim)" },
  finding: { label: "New finding added", color: "var(--color-poor)" },
  notice: { label: "Notice recorded", color: "var(--color-fair)" },
  reply: { label: "Operator replied", color: "var(--color-trip)" },
  dispute: { label: "Operator disputed the notice", color: "var(--color-disputed)" },
  upheld: { label: "Dispute decided: the notice stands", color: "var(--color-fair)" },
  withdrawn: { label: "Withdrawn by the city", color: "var(--color-good)" },
  follow_up: { label: "City wrote again", color: "var(--color-fair)" },
  resolved: { label: "Closed", color: "var(--color-good)" },
  reopened: { label: "Reopened", color: "var(--color-poor)" },
};

/** What an operator did, as a title: "Pronghorn Rides was over its fleet cap". */
const DID: Record<RuleKind, string> = {
  fleet_cap: "had more vehicles out than its permit allows",
  equity_minimum: "fell short of the equity zone minimum",
  parking_dwell: "left vehicles in one place too long",
  rebalancing_sla: "missed the deadline to move badly parked vehicles",
  slow_zone_speed: "vehicles were ridden too fast through slow zones",
};
export const caseTitle = (kind: RuleKind, operatorName: string) => `${operatorName} ${DID[kind]}`;
export const weekLabel = (week: string) => `Week of ${plainShort(week)}`;
export const ruleLabel = (kind: RuleKind) => RULES[kind].label;

/** "Step 2 · Fine of $250" */
export const stepLabel = (step: number) => `Step ${step} · ${stepInfo(step).label}`;

type Clock = { status: CaseStatus; dueAt: number | null; replied: boolean };

/** Whose move it is and by when, in a few words, with the colour it should be shown in. */
export function clock(c: Clock, now: number, forOperator = false): { text: string; color: string; urgent: boolean } | null {
  if (c.dueAt === null) return null;
  const day = plainDay(dueDate(c.dueAt));
  const state = dueState(c.dueAt, now);
  if (c.status === "disputed") {
    if (state === "overdue") return { text: `City decision overdue since ${day}`, color: forOperator ? "var(--color-dim)" : "var(--color-poor)", urgent: !forOperator };
    return { text: `City decides by ${day}`, color: state === "soon" && !forOperator ? "var(--color-fair)" : "var(--color-dim)", urgent: false };
  }
  if (c.status !== "notified") return null;
  if (c.replied) return { text: forOperator ? "Reply sent. The city is checking it" : "Operator has replied: check and close", color: forOperator ? "var(--color-dim)" : "var(--color-trip)", urgent: !forOperator };
  if (state === "overdue") return { text: forOperator ? `Reply was due ${day}` : `No reply. Was due ${day}`, color: "var(--color-poor)", urgent: true };
  return { text: `Reply due ${day}`, color: state === "soon" ? "var(--color-fair)" : "var(--color-dim)", urgent: forOperator && state === "soon" };
}
