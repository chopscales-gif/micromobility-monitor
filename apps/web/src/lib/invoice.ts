import { formatCents } from "@mm/core/fees";
import { count } from "./format";

type Reconciled = {
  operatorName: string;
  observedTrips: number;
  reportedTrips: number | null;
  deltaTrips: number | null;
  feeAtRiskCents: number | null;
  flagged: boolean;
  rejectedTripRecords: number;
  schedule: { perRideCents: number; discrepancyTolerancePct: number; discrepancyToleranceTrips: number };
};

export type Verdict = { key: "disagree" | "agree" | "waiting"; label: string; color: string; headline: string; explanation: string };

/** The plain-English reading of an invoice's reconciliation, used on screen, in the CSV and in the PDF. */
export function verdict(i: Reconciled): Verdict {
  const tolerance = `${i.schedule.discrepancyTolerancePct}% and ${i.schedule.discrepancyToleranceTrips} rides`;
  if (i.reportedTrips === null || i.deltaTrips === null) {
    return {
      key: "waiting",
      label: "Awaiting report",
      color: "var(--color-removed)",
      headline: "The operator has not filed its monthly report yet.",
      explanation: "The invoice is calculated from the trip records the city received. It will be compared with the operator's own count when the report arrives.",
    };
  }
  if (!i.flagged) {
    return {
      key: "agree",
      label: "Reconciled",
      color: "var(--color-good)",
      headline: i.deltaTrips === 0 ? "The operator's report matches the city's count exactly." : `The two counts differ by ${count(Math.abs(i.deltaTrips))} rides, inside the tolerance.`,
      explanation: `A difference is only flagged when it is larger than both ${tolerance}.`,
    };
  }
  if (i.deltaTrips > 0) {
    return {
      key: "disagree",
      label: "Counts disagree",
      color: "var(--color-poor)",
      headline: `${i.operatorName} reported ${count(i.deltaTrips)} fewer rides than its own trip feed delivered.`,
      explanation: `Billing on the operator's count would have missed ${formatCents(i.feeAtRiskCents ?? 0)}. This invoice bills the rides the city received records for.`,
    };
  }
  const missing = Math.abs(i.deltaTrips);
  const rejected =
    i.rejectedTripRecords > 0
      ? `${count(i.rejectedTripRecords)} trip records were rejected this month for failing the schema, which is enough to account for ${i.rejectedTripRecords >= missing ? "all of it" : "part of it"}.`
      : "No trip records were rejected this month, so the gap is unexplained.";
  return {
    key: "disagree",
    label: "Counts disagree",
    color: "var(--color-poor)",
    headline: `${i.operatorName} reported ${count(missing)} more rides than the city received valid records for.`,
    explanation: `${rejected} Until the operator resupplies them, up to ${formatCents(missing * i.schedule.perRideCents)} in ride fees is not on this invoice.`,
  };
}
