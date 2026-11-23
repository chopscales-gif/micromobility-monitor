"use server";

import { redirect } from "next/navigation";
import { parseZoneGeoJson, SLOW_ZONE_LIMITS, ZONE_NAME_MAX, ZONE_TYPES, type ZoneType } from "@mm/core/zones";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";
import { createZone, retireZone } from "@/server/zones";

const back = (query: string): never => redirect(`/zones?${query}`);
const problem = (text: string): never => back(`problem=${encodeURIComponent(text)}`);

export async function adopt(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const type = String(formData.get("type") ?? "") as ZoneType;
  const source = formData.get("source") === "upload" ? "upload" : "drawn";
  if (!name || name.length > ZONE_NAME_MAX) problem(`Give the zone a name of up to ${ZONE_NAME_MAX} characters.`);
  if (!ZONE_TYPES.includes(type)) problem("Choose what kind of zone this is.");

  let speedLimitKph: number | null = null;
  if (type === "slow_ride") {
    const text = String(formData.get("speedLimitKph") ?? "").trim();
    speedLimitKph = /^\d+$/.test(text) ? Number(text) : null;
    if (speedLimitKph === null || speedLimitKph < SLOW_ZONE_LIMITS.min || speedLimitKph > SLOW_ZONE_LIMITS.max) problem(`A slow zone needs a speed limit between ${SLOW_ZONE_LIMITS.min} and ${SLOW_ZONE_LIMITS.max} km/h.`);
  }

  // The browser checked the shape before sending it. It is checked again here, because the browser can be made to send anything.
  const parsed = parseZoneGeoJson(String(formData.get("shape") ?? ""));
  if (!parsed.ok) return problem(parsed.problem);

  let refusal: string | null = null;
  try {
    refusal = await createZone(await currentPerson(), { name, type, speedLimitKph, polygons: parsed.polygons, source });
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back("refused=1");
  }
  if (refusal) problem(refusal);
  back(`adopted=${encodeURIComponent(name)}`);
}

export async function retire(formData: FormData) {
  let refusal: string | null = null;
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/.test(id)) problem("That zone does not exist.");
  try {
    refusal = await retireZone(await currentPerson(), id);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back("refused=1");
  }
  back(refusal ? `problem=${encodeURIComponent(refusal)}` : "retired=1");
}
