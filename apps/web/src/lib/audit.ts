// Turns an audit row into a sentence a person can read.

import { monthLabel } from "@mm/core/city";
import { formatCents } from "@mm/core/fees";
import { RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { ZONE_LABELS, type ZoneType } from "@mm/core/zones";
import type { AuditEntry } from "@/server/audit";
import { caseReference } from "@mm/core/cases";
import { count, plainDate, timeOnly } from "./format";
import { reference } from "./violations";

const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? plainDate(value) : String(value));

const RESOURCES: Record<string, string> = {
  live_map: "the live map",
  trip_heatmap: "the trip heatmap",
  map_playback: "map playback",
  data_health: "data health",
  fee_schedule: "the fee schedule",
  invoice_list: "the list of invoices",
  invoice: "an invoice",
  invoice_trip_ledger: "an invoice's trip ledger",
  audit_log: "the audit log",
  case_queue: "the case queue",
  case: "a case",
  standing: "the standing on each rule",
  finding: "a finding",
  alerts: "their alerts",
  outbox: "the outbox of outgoing mail",
  access: "the list of seats",
  zones: "the policy zones",
  rules: "the rules",
  monthly_report: "the monthly report",
};

const CASE_STEPS: Record<string, [done: string, refused: string]> = {
  notice: ["Recorded a notice on", "Tried to record a notice on"],
  close: ["Closed without notice", "Tried to close"],
  reply: ["Replied on", "Tried to reply on"],
  dispute: ["Disputed", "Tried to dispute"],
  uphold: ["Upheld the notice on", "Tried to uphold the notice on"],
  withdraw: ["Withdrew the notice on", "Tried to withdraw the notice on"],
  follow_up: ["Followed up on", "Tried to follow up on"],
  resolve: ["Closed as corrected", "Tried to close"],
  reopen: ["Reopened", "Tried to reopen"],
};

const isRuleKind = (value: unknown): value is RuleKind => RULE_KINDS.includes(value as RuleKind);

const VERBS: Record<string, [done: string, refused: string]> = {
  read: ["Viewed", "Tried to view"],
  export: ["Exported", "Tried to export"],
  change: ["Changed", "Tried to change"],
};

export function sentence(e: AuditEntry): string {
  const d = e.detail ?? {};
  const verb = (VERBS[e.action] ?? ["Used", "Tried to use"])[e.allowed ? 0 : 1];
  const number = typeof d.number === "string" ? d.number : null;
  if (e.resource === "invoice" && number) {
    if (d.found === false) return `Asked for invoice ${number}, which has not been issued to this account`;
    if (e.action === "change" && d.change === "issued") return `${e.allowed ? "Signed off and issued" : "Tried to issue"} invoice ${number}`;
    if (e.action === "change") return `${e.allowed ? "Recalculated" : "Tried to recalculate"} invoice ${number}`;
    return `${verb} invoice ${number}${typeof d.format === "string" ? ` as ${d.format.toUpperCase()}` : ""}`;
  }
  if (e.resource === "invoice_trip_ledger" && number) return `${verb} the trip ledger behind invoice ${number} as CSV`;
  if (e.resource === "case" && number) {
    const ref = number;
    if (d.found === false) return `Asked for case ${ref}, which ${e.role === "operator" ? "this account may not see" : "is not on record"}`;
    if (e.action === "change") {
      const [done, tried] = CASE_STEPS[String(d.step)] ?? ["Changed", "Tried to change"];
      return `${e.allowed ? done : tried} case ${ref}`;
    }
    return `${verb} case ${ref}`;
  }
  if (e.resource === "finding" && number) {
    const ref = number;
    if (d.found === false) return `Asked for finding ${ref}, which ${e.role === "operator" ? "this account may not see" : "is not on record"}`;
    if (e.action === "change") {
      const [done, tried] = d.to === "counted" ? ["Checked and counted", "Tried to count"] : ["Set aside", "Tried to set aside"];
      return `${e.allowed ? done : tried} finding ${ref}`;
    }
    return `${verb} the evidence for finding ${ref}`;
  }
  if (e.resource === "zones" && e.action === "change" && typeof d.name === "string") {
    const [done, tried] = d.change === "retired" ? ["Retired", "Tried to retire"] : ["Adopted", "Tried to adopt"];
    return `${e.allowed ? done : tried} the zone “${d.name}”`;
  }
  if (e.resource === "rules" && e.action === "change" && isRuleKind(d.kind)) return `${e.allowed ? "Changed" : "Tried to change"} the rule “${RULES[d.kind].label}”`;
  if (e.resource === "fee_schedule" && e.action === "change") {
    if (d.change === "withdrawn") return `${e.allowed ? "Withdrew" : "Tried to withdraw"} the fee schedule due to take effect ${day(d.effectiveFrom)}`;
    return `${e.allowed ? "Adopted" : "Tried to adopt"} a fee schedule`;
  }
  return `${verb} ${RESOURCES[e.resource] ?? e.resource.replaceAll("_", " ")}`;
}

/** The small print under the sentence: what exactly was asked for. */
export function particulars(e: AuditEntry): string | null {
  const d = e.detail ?? {};
  const parts: string[] = [];
  if (e.resource === "fee_schedule" && e.action === "change" && typeof d.perRideCents === "number") {
    parts.push(`from ${day(d.effectiveFrom)}`, `${formatCents(d.perDeviceAnnualCents as number)} per device per year`, `${formatCents(d.perRideCents)} per ride`);
    if (typeof d.note === "string" && d.note) parts.push(`"${d.note}"`);
  }
  if (e.resource === "zones" && e.action === "change") {
    if (typeof d.type === "string") parts.push(ZONE_LABELS[d.type as ZoneType] ?? d.type);
    if (typeof d.speedLimitKph === "number") parts.push(`${d.speedLimitKph} km/h limit`);
    if (d.source === "upload") parts.push("from an uploaded GeoJSON file");
    if (d.source === "drawn") parts.push("drawn on the map");
  }
  if (e.resource === "rules" && e.action === "change" && isRuleKind(d.kind)) {
    parts.push(d.enabled === false ? "switched off" : "in force");
    for (const spec of RULES[d.kind].params) if (typeof d[spec.key] === "number") parts.push(`${spec.label.toLowerCase()}: ${d[spec.key]} ${spec.unit}`);
  }
  if (e.resource === "monthly_report" && typeof d.month === "string") {
    const [year, month] = d.month.split("-").map(Number);
    if (year && month) parts.push(monthLabel(year, month));
    if (d.format === "pdf") parts.push("as a PDF");
  }
  if (typeof d.reads === "number" && d.reads > 1) parts.push(`${count(d.reads)} times, last at ${timeOnly(Number(d.last_read) || Date.parse(String(d.last_read)))}`);
  if (typeof d.days === "number") parts.push(`last ${d.days} day${d.days === 1 ? "" : "s"}`);
  if (typeof d.hours === "number") parts.push(`last ${d.hours} hours`);
  if (d.end === "origins") parts.unshift("trip starts");
  if (d.end === "destinations") parts.unshift("trip ends");
  return parts.length > 0 ? parts.join(" · ") : null;
}
