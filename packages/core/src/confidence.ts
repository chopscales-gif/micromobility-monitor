// Data confidence: whether the record is firm enough to put a finding to an operator.
// A finding that could be an artefact of GPS error or of a faulty feed is held and
// marked with the reason, rather than filed as a violation. Pure: no database, no clock.

import { boundaryDistanceMeters, type LngLat } from "./geo";
import { zoneInForce, type MisparkReason, type RuleZone, type Stay } from "./rules";

/** A parked vehicle's reported position can be this far from where it stands: a usual figure for a phone-grade receiver between buildings. */
export const GPS_MARGIN_METERS = 15;
/** A vehicle is not said to have stood untouched if at least this share of its operator's status records had to be rejected meanwhile. */
export const RECORD_LOSS_HOLD_PCT = 1;
/** The record is behind when the operator's latest hourly file is this late. */
export const RECORD_BEHIND_HOURS = 3;

export type HoldReason =
  /** Vehicles counted as badly parked only because of which side of a line GPS put them; without them the rule is not broken. */
  | { code: "gps_margin"; marginMeters: number; marginal: number; firm: number; allowance: number }
  /** A parked vehicle's stay rests on there being no ride in between, and records went missing in that time. */
  | { code: "record_loss"; rejectedPct: number; limitPct: number }
  /** A count that broke the rule by less than the share of records that had to be rejected. */
  | { code: "within_loss"; rejectedPct: number; marginPct: number }
  /** The operator's feed was behind when the finding was made, so the period is not fully on record. */
  | { code: "record_behind"; hoursBehind: number };

export const HOLD_CODES = ["gps_margin", "record_loss", "within_loss", "record_behind"] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * How close a badly parked vehicle is to the line that makes it badly parked. Null when no line
 * decides it: the operator itself reported the vehicle as outside the permitted area.
 */
export function misparkMarginMeters(stay: Stay, reason: MisparkReason, zones: RuleZone[]): number | null {
  if (stay.outside && reason === "outside_area") return null;
  const point: LngLat = [stay.lng, stay.lat];
  const type = reason === "outside_area" ? "service_area" : reason;
  const deciding = zones.filter((z) => z.type === type && zoneInForce(z, stay.from));
  if (deciding.length === 0) return null;
  return boundaryDistanceMeters(point, deciding.flatMap((z) => z.polygons));
}

/** A day of missed deadlines stands only if it would stand without the vehicles inside the GPS margin. */
export function assessSla(margins: (number | null)[], allowance: number, marginMeters = GPS_MARGIN_METERS): HoldReason | null {
  const marginal = margins.filter((m) => m !== null && m <= marginMeters).length;
  const firm = margins.length - marginal;
  return marginal > 0 && firm <= allowance ? { code: "gps_margin", marginMeters, marginal, firm, allowance } : null;
}

/** A vehicle "left untouched" is only as sure as the record of its rides and collections is complete. */
export function assessDwell(rejectedPct: number, limitPct = RECORD_LOSS_HOLD_PCT): HoldReason | null {
  return rejectedPct >= limitPct ? { code: "record_loss", rejectedPct: round1(rejectedPct), limitPct } : null;
}

/** A count or share stands only if it broke the rule by more than the share of records that went missing. */
export function assessCount(measured: number, threshold: number, rejectedPct: number): HoldReason | null {
  if (threshold === 0 || rejectedPct <= 0) return null;
  const marginPct = (Math.abs(measured - threshold) / threshold) * 100;
  return marginPct <= rejectedPct ? { code: "within_loss", rejectedPct: round1(rejectedPct), marginPct: round1(marginPct) } : null;
}

/** A period the feed has not caught up with cannot be judged yet. */
export function assessLag(periodEnd: number | null, recordThrough: number | null, now: number, limitHours = RECORD_BEHIND_HOURS): HoldReason | null {
  if (recordThrough === null) return null;
  const behind = (now - recordThrough) / 3_600_000;
  if (behind < limitHours || (periodEnd !== null && periodEnd <= recordThrough)) return null;
  return { code: "record_behind", hoursBehind: Math.round(behind) };
}

/** The share of records rejected between two moments, from hourly counts. */
export function rejectedShare(hours: { hour: number; records: number; rejected: number }[], from: number, to: number): number {
  let records = 0;
  let rejected = 0;
  for (const h of hours) {
    if (h.hour + 3_600_000 <= from || h.hour >= to) continue;
    records += h.records;
    rejected += h.rejected;
  }
  return records === 0 ? 0 : (rejected / records) * 100;
}
