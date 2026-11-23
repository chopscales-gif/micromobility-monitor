// Cases: how findings are grouped, worked and escalated. A case is everything one
// operator did against one rule in one week. Pure: no database, no clock.

import { addDays, localDate, startOfLocalDay, weekStart } from "./city";

export const CASE_STATUSES = ["held", "open", "notified", "disputed", "resolved"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** How a resolved case ended. Only a case that was withdrawn, or closed without a notice, stays off the operator's record. */
export const CASE_OUTCOMES = ["corrected", "withdrawn", "closed"] as const;
export type CaseOutcome = (typeof CASE_OUTCOMES)[number];

export const STANDINGS = ["counted", "held", "set_aside"] as const;
export type Standing = (typeof STANDINGS)[number];

export const EVENT_KINDS = ["opened", "notice", "reply", "dispute", "upheld", "withdrawn", "follow_up", "resolved", "reopened", "finding"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** What an operator is shown of a case's history: the exchange with the city, and how it ended. Staff's working notes stay with staff. */
export const OPERATOR_SEES: readonly EventKind[] = ["notice", "reply", "dispute", "upheld", "withdrawn", "follow_up", "resolved", "reopened"];

/** An operator has this many working days to answer a notice, and the city the same to decide a dispute. */
export const RESPONSE_WORKING_DAYS = 5;
export const DECISION_WORKING_DAYS = 5;
/** A deadline is "near" from this many days before it: three, so that a Monday deadline is near on the Friday. */
export const DUE_SOON_DAYS = 3;

/** The Monday, in the city's calendar, of the week a finding belongs to. */
export const caseWeek = (periodStart: number) => weekStart(localDate(periodStart));

const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

/** The date `days` working days after the day containing `from`. Weekends are skipped; public holidays are not modelled. */
export function workingDaysAfter(from: number, days: number): string {
  let date = localDate(from);
  for (let left = days; left > 0; ) {
    date = addDays(date, 1);
    if (!isWeekend(date)) left--;
  }
  return date;
}

/** A deadline falls at the end of its day: the instant the next day begins. */
export const deadline = (from: number, workingDays: number) => startOfLocalDay(addDays(workingDaysAfter(from, workingDays), 1));
/** The day a deadline falls on, for display. */
export const dueDate = (dueAt: number) => localDate(dueAt - 1);

export type DueState = "none" | "ahead" | "soon" | "overdue";
export function dueState(dueAt: number | null, now: number): DueState {
  if (dueAt === null) return "none";
  if (now >= dueAt) return "overdue";
  return dueAt - now <= DUE_SOON_DAYS * 86_400_000 ? "soon" : "ahead";
}

// --- The escalation ladder -----------------------------------------------------

export type LadderStep = { step: number; key: "warning" | "fine" | "review"; label: string; fineCents: number; consequence: string; needsProgramManager: boolean };

/**
 * What a notice carries, by how many earlier notices the operator has had on the same rule.
 * The count is of weeks with a notice that was not withdrawn, in the twelve months before.
 */
export const LADDER: readonly LadderStep[] = [
  { step: 1, key: "warning", label: "Written warning", fineCents: 0, consequence: "A written warning. No fine.", needsProgramManager: false },
  { step: 2, key: "fine", label: "Fine of $250", fineCents: 25_000, consequence: "A fine of $250.", needsProgramManager: false },
  { step: 3, key: "fine", label: "Fine of $500", fineCents: 50_000, consequence: "A fine of $500.", needsProgramManager: false },
  { step: 4, key: "review", label: "Permit review", fineCents: 50_000, consequence: "A fine of $500, and the permit is referred for a suspension review.", needsProgramManager: true },
];
export const LADDER_WINDOW_MONTHS = 12;

/** The rung a notice lands on, given the notices that went before it. */
export function ladderStep(priorNotices: number): LadderStep {
  return LADDER[Math.min(Math.max(priorNotices, 0), LADDER.length - 1)]!;
}
export const stepInfo = (step: number) => LADDER[Math.min(Math.max(step, 1), LADDER.length) - 1]!;

// --- What can happen to a case -------------------------------------------------

export const CASE_ACTIONS = ["notice", "close", "reply", "dispute", "uphold", "withdraw", "follow_up", "resolve", "reopen"] as const;
export type CaseAction = (typeof CASE_ACTIONS)[number];

type ActionRule = { from: readonly CaseStatus[]; to: CaseStatus; by: "staff" | "operator"; event: EventKind; needsNote: boolean; outcome?: CaseOutcome };

export const ACTIONS: Record<CaseAction, ActionRule> = {
  /** Records that the operator has been told. Starts the operator's clock. */
  notice: { from: ["open"], to: "notified", by: "staff", event: "notice", needsNote: true },
  /** Closes a case without telling the operator. It does not count on the ladder. */
  close: { from: ["open", "held"], to: "resolved", by: "staff", event: "resolved", needsNote: true, outcome: "closed" },
  /** The operator says what it has done. The case stays with the city to check and close. */
  reply: { from: ["notified"], to: "notified", by: "operator", event: "reply", needsNote: true },
  /** The operator says the finding is wrong. Stops the operator's clock and starts the city's. */
  dispute: { from: ["notified"], to: "disputed", by: "operator", event: "dispute", needsNote: true },
  /** The city has looked again and the case stands. The operator's clock starts again. */
  uphold: { from: ["disputed"], to: "notified", by: "staff", event: "upheld", needsNote: true },
  /** The city drops the case. It comes off the operator's record. */
  withdraw: { from: ["disputed", "notified"], to: "resolved", by: "staff", event: "withdrawn", needsNote: true, outcome: "withdrawn" },
  /** A further message to the operator on a live notice. */
  follow_up: { from: ["notified"], to: "notified", by: "staff", event: "follow_up", needsNote: true },
  resolve: { from: ["notified"], to: "resolved", by: "staff", event: "resolved", needsNote: true, outcome: "corrected" },
  reopen: { from: ["resolved"], to: "open", by: "staff", event: "reopened", needsNote: true },
};

/** The actions open to one side on a case as it stands. */
export function actionsFor(status: CaseStatus, by: "staff" | "operator"): CaseAction[] {
  return CASE_ACTIONS.filter((a) => ACTIONS[a].by === by && ACTIONS[a].from.includes(status));
}

/** A case with nothing firm in it waits in the held pile; one firm finding is enough to put it in the queue. */
export function restingStatus(counted: number, held: number): "open" | "held" {
  return counted === 0 && held > 0 ? "held" : "open";
}

/** The reference staff and operators quote for a case. */
export const caseReference = (number: number) => `C-${String(number).padStart(5, "0")}`;
