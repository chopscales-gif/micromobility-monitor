"use server";

import { redirect } from "next/navigation";
import { CASE_ACTIONS, type CaseAction } from "@mm/core/cases";
import { act, rule } from "@/server/cases";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

const whole = (value: FormDataEntryValue | null) => (typeof value === "string" && /^\d{1,9}$/.test(value) ? Number(value) : null);
const noteOf = (formData: FormData) => String(formData.get("note") ?? "").slice(0, 1200);

/** One step on a case: a notice, a reply, a dispute, a decision, a closure. */
export async function step(formData: FormData) {
  const number = whole(formData.get("number"));
  const action = String(formData.get("action") ?? "") as CaseAction;
  if (number === null || !CASE_ACTIONS.includes(action)) redirect("/cases");
  const back = (query: string): never => redirect(`/cases/${number}?${query}`);
  let problem: string | null = null;
  try {
    problem = await act(await currentPerson(), number, action, noteOf(formData));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back("refused=1");
  }
  back(problem ? `problem=${encodeURIComponent(problem)}` : `done=${action}`);
}

/** A member of staff's ruling on one finding: it counts, or it is set aside. */
export async function ruleOn(formData: FormData) {
  const number = whole(formData.get("finding"));
  const home = whole(formData.get("case"));
  const to = formData.get("to") === "counted" ? "counted" : "set_aside";
  if (number === null) redirect("/cases");
  let result: { problem: string | null; caseNumber: number | null } = { problem: null, caseNumber: home };
  try {
    result = await rule(await currentPerson(), number, to, noteOf(formData));
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    redirect(home === null ? "/cases" : `/cases/${home}?refused=1`);
  }
  const target = result.caseNumber ?? home;
  if (target === null) redirect("/cases");
  redirect(`/cases/${target}?${result.problem ? `problem=${encodeURIComponent(result.problem)}` : `done=${to}`}#findings`);
}
