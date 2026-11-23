"use server";

import { clock } from "@mm/core/clock";
import { redirect } from "next/navigation";
import { localDate } from "@mm/core/city";
import { adoptSchedule, withdrawSchedule } from "@/server/fees";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

const back = (query: string): never => redirect(`/fees?${query}`);

/** Dollars typed by a person, to whole cents. Null when it is not a sensible amount. */
function cents(value: FormDataEntryValue | null, max: number): number | null {
  const text = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const amount = Math.round(Number(text) * 100);
  return amount <= max ? amount : null;
}

function whole(value: FormDataEntryValue | null, max: number): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text) <= max ? Number(text) : null;
}

export async function adopt(formData: FormData) {
  const effectiveFrom = String(formData.get("effectiveFrom") ?? "");
  const perDeviceAnnualCents = cents(formData.get("perDevice"), 100_000);
  const perRideCents = cents(formData.get("perRide"), 1_000);
  const minBillableTripSeconds = whole(formData.get("minSeconds"), 600);
  const discrepancyToleranceTrips = whole(formData.get("toleranceTrips"), 10_000);
  const tolerance = String(formData.get("tolerancePct") ?? "").trim();
  const discrepancyTolerancePct = /^\d+(\.\d)?$/.test(tolerance) && Number(tolerance) <= 25 ? Number(tolerance) : null;
  const note = String(formData.get("note") ?? "").trim().slice(0, 200);

  let problem = "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || Number.isNaN(Date.parse(effectiveFrom))) problem = "Choose the date the schedule takes effect.";
  else if (effectiveFrom <= localDate(clock())) problem = "The effective date must be in the future, so invoices already issued are not changed.";
  else if (perDeviceAnnualCents === null) problem = "The device fee must be a dollar amount up to $1,000.";
  else if (perRideCents === null) problem = "The ride fee must be a dollar amount up to $10.";
  else if (minBillableTripSeconds === null) problem = "The shortest billable ride must be a whole number of seconds, up to 600.";
  else if (discrepancyTolerancePct === null) problem = "The tolerance must be a percentage up to 25, with at most one decimal place.";
  else if (discrepancyToleranceTrips === null) problem = "The tolerance in rides must be a whole number up to 10,000.";
  else if (!note) problem = "Add a short note saying why the schedule is changing. It goes in the record.";
  if (problem) back(`problem=${encodeURIComponent(problem)}`);

  try {
    await adoptSchedule(await currentPerson(), {
      effectiveFrom,
      perDeviceAnnualCents: perDeviceAnnualCents!,
      perRideCents: perRideCents!,
      minBillableTripSeconds: minBillableTripSeconds!,
      exemptEquityZoneTrips: formData.get("exemptEquity") === "on",
      discrepancyTolerancePct: discrepancyTolerancePct!,
      discrepancyToleranceTrips: discrepancyToleranceTrips!,
      note,
    });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back("refused=1");
  }
  back("adopted=1");
}

export async function withdraw(formData: FormData) {
  let done = false;
  try {
    done = await withdrawSchedule(await currentPerson(), String(formData.get("id") ?? ""));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back("refused=1");
  }
  back(done ? "withdrawn=1" : "problem=" + encodeURIComponent("That schedule is already in force and cannot be withdrawn."));
}
