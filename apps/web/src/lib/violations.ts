// The words the finding screens use: one sentence per finding, one label and colour per standing.

import type { Standing } from "@mm/core/cases";
import type { HoldReason } from "@mm/core/confidence";
import type { DwellEvidence, EquityEvidence, FleetCapEvidence, MisparkReason, RuleKind, RuleParams, SlaEvidence } from "@mm/core/rules";
import { count, dateTime, dayLabel, shortDay, span } from "./format";
import { TYPES } from "./meaning";

/** Where a finding stands inside its case. */
export const STANDINGS: Record<Standing, { label: string; hint: string; color: string }> = {
  counted: { label: "Counted", hint: "Firm enough to put to the operator", color: "var(--color-poor)" },
  held: { label: "Held", hint: "The data is not firm enough yet. A member of staff checks it before it counts", color: "var(--color-held)" },
  set_aside: { label: "Set aside", hint: "Dropped by a member of staff. It does not count", color: "var(--color-removed)" },
};

/** Why the rule engine held a finding back, in a sentence. */
export function holdSentence(h: HoldReason): string {
  switch (h.code) {
    case "gps_margin":
      return `${count(h.marginal)} of the vehicles counted ${h.marginal === 1 ? "was" : "were"} within ${h.marginMeters} metres of the zone line, which is inside ordinary GPS error. Without ${h.marginal === 1 ? "it" : "them"}, ${count(h.firm)} deadlines were missed against ${count(h.allowance)} tolerated, so the rule is not firmly broken.`;
    case "record_loss":
      return `${h.rejectedPct}% of this operator's status records had to be rejected while the vehicle stood here; the limit is ${h.limitPct}%. A ride or a collection may be among the records that were lost.`;
    case "within_loss":
      return `The rule was broken by ${h.marginPct}%, and ${h.rejectedPct}% of the operator's records were rejected over the same period. The gap is no bigger than the missing records could explain.`;
    case "record_behind":
      return `The operator's hourly record was ${h.hoursBehind} hours behind when this was found, so the period is not yet fully on record.`;
  }
}
export const HOLD_LABELS: Record<HoldReason["code"], string> = {
  gps_margin: "Inside GPS error",
  record_loss: "Records lost meanwhile",
  within_loss: "Within the records lost",
  record_behind: "Feed was behind",
};

/** `color` follows the theme; `hex` is for the evidence map, which is drawn light in either theme. */
export const REASONS: Record<MisparkReason, { label: string; color: string; hex: string }> = {
  no_parking: { label: "In a no-parking zone", color: "var(--color-zone-no-parking)", hex: "#d0611c" },
  no_ride: { label: "In a no-ride zone", color: "var(--color-poor)", hex: "#c8284a" },
  outside_area: { label: "Outside the service area", color: "var(--color-zone-outside)", hex: "#6a4fc4" },
};

/** The reference staff and operators quote. */
export const reference = (number: number) => `V-${String(number).padStart(5, "0")}`;

export type SpeedEvidenceStored = {
  passes: number;
  speeding: number;
  toleranceKph: number;
  zones: { zoneId: string; name: string; limitKph: number; passes: number; speeding: number }[];
  worst: { tripId: string; deviceId: string; zoneId: string; code: string; zone: string; enteredAt: number; maxKph: number; readingsOver: number; readings: number }[];
};

export type Finding = {
  kind: RuleKind;
  measured: number;
  threshold: number;
  periodStart: number;
  periodEnd: number | null;
  evidence: unknown;
  params: unknown;
};

const one = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const hourOfDay = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
export { hourOfDay };

/** What was found, in one sentence a council member could read. */
export function headline(f: Finding): string {
  switch (f.kind) {
    case "fleet_cap": {
      const e = f.evidence as FleetCapEvidence;
      return `${count(e.peak)} vehicles on the street against a permit for ${count(e.permitted)}. Over the cap for ${span(e.minutesOver)} of the day.`;
    }
    case "equity_minimum": {
      const e = f.evidence as EquityEvidence;
      return `${one(f.measured)}% of available vehicles were in equity zones at ${hourOfDay(e.checkHour)}, averaged over the week. The minimum is ${one(f.threshold)}%.`;
    }
    case "parking_dwell": {
      const e = f.evidence as DwellEvidence;
      return `${TYPES[e.vehicleType] ?? "Vehicle"} ${e.code} ${e.movedAt === null ? "has stood" : "stood"} in one spot for ${span(e.hours * 60)}. The limit is ${one(f.threshold)} hours.`;
    }
    case "rebalancing_sla": {
      const e = f.evidence as SlaEvidence;
      return `${count(e.total)} badly parked vehicles were not moved within ${one(e.hours)} hours. ${one(f.threshold)} a day are tolerated.`;
    }
    case "slow_zone_speed": {
      const e = f.evidence as SpeedEvidenceStored;
      return `${one(f.measured)}% of rides through slow zones were over the limit (${count(e.speeding)} of ${count(e.passes)}). ${one(f.threshold)}% is tolerated.`;
    }
  }
}

/** The day, week or stay a finding is about. */
export function period(f: Finding): string {
  if (f.kind === "equity_minimum") return `Week of ${shortDay(f.periodStart)} to ${shortDay((f.periodEnd ?? f.periodStart) - 3_600_000)}`;
  if (f.kind === "parking_dwell") return f.periodEnd === null ? `Parked since ${dateTime(f.periodStart)}, still there` : `Parked ${dateTime(f.periodStart)} to ${dateTime(f.periodEnd)}`;
  return dayLabel(f.periodStart);
}

/** A short title for the finding's own page. */
export function title(f: Finding, operatorName: string): string {
  switch (f.kind) {
    case "fleet_cap":
      return `${operatorName} had more vehicles out than its permit allows`;
    case "equity_minimum":
      return `${operatorName} fell short of the equity zone minimum`;
    case "parking_dwell":
      return `${operatorName} left a vehicle in one place too long`;
    case "rebalancing_sla":
      return `${operatorName} missed the deadline to move badly parked vehicles`;
    case "slow_zone_speed":
      return `${operatorName} vehicles were ridden too fast through slow zones`;
  }
}

/** The rule as it was applied, in a sentence, with the settings in force at the time. */
export function ruleSentence<K extends RuleKind>(kind: K, raw: unknown): string {
  const p = raw as RuleParams[RuleKind];
  switch (kind) {
    case "fleet_cap": {
      const { graceMinutes } = p as RuleParams["fleet_cap"];
      return `An operator may not have more vehicles on the street than its permit allows. Being over for ${graceMinutes} minutes or less is forgiven, so crews can swap vehicles.`;
    }
    case "equity_minimum": {
      const { minSharePct, checkHour } = p as RuleParams["equity_minimum"];
      return `At least ${one(minSharePct)}% of each operator's available vehicles must be inside an equity zone at ${hourOfDay(checkHour)}, averaged over each week, Monday to Sunday.`;
    }
    case "parking_dwell": {
      const { limitHours } = p as RuleParams["parking_dwell"];
      return `No vehicle may stand in the same spot for more than ${limitHours} hours without being ridden or collected.`;
    }
    case "rebalancing_sla": {
      const { hours, dailyAllowance } = p as RuleParams["rebalancing_sla"];
      return `A vehicle left in a no-parking zone, in a no-ride zone or outside the service area must be moved within ${one(hours)} hours. Up to ${dailyAllowance} missed deadlines a day are tolerated.`;
    }
    default: {
      const { toleranceKph, maxSharePct } = p as RuleParams["slow_zone_speed"];
      return `Rides through a slow zone must keep to its posted limit. A ride counts as over the limit when two location readings in a row exceed it by more than ${one(toleranceKph)} km/h. Up to ${one(maxSharePct)}% of a day's rides may be over.`;
    }
  }
}

/** How each rule is measured, for the rules page and for an operator disputing a finding. */
export const METHODS: Record<RuleKind, string> = {
  fleet_cap: "Counted from the operator's own MDS status changes: every vehicle that is available, reserved, being ridden or out of order on the street. Vehicles the operator has collected are not counted. Judged per day.",
  equity_minimum: "Counted from each vehicle's latest MDS status at the check hour. Only vehicles a rider could rent are counted. Judged once a week is over.",
  parking_dwell: "A stay begins when a vehicle is parked and ends when it is ridden, collected or reported more than 15 metres away. One finding per vehicle per stay.",
  rebalancing_sla: "The clock starts when the vehicle is left there and stops when it is ridden or collected. A vehicle is judged against the zones in force when it was parked. One finding per operator per day.",
  slow_zone_speed: "Measured from the speed in each ride's MDS location readings while inside the zone. A day with fewer than 20 rides through slow zones is not judged. Judged once the day is over.",
};
