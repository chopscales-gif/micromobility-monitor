"use server";

import { redirect } from "next/navigation";
import { checkParams, RULE_KINDS, RULES, type RuleKind } from "@mm/core/rules";
import { Refused } from "@/server/guard";
import { changeRule } from "@/server/rules";
import { currentPerson } from "@/server/session";

const back = (query: string): never => redirect(`/rules?${query}`);

export async function save(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as RuleKind;
  if (!RULE_KINDS.includes(kind)) back(`problem=${encodeURIComponent("That rule does not exist.")}`);
  const checked = checkParams(kind, Object.fromEntries(RULES[kind].params.map((spec) => [spec.key, formData.get(spec.key)])));
  if (!checked.ok) return back(`problem=${encodeURIComponent(`${RULES[kind].label}: ${checked.problem}`)}`);

  try {
    await changeRule(await currentPerson(), kind, checked.params as Record<string, number>, formData.get("enabled") === "on");
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back("refused=1");
  }
  back(`saved=${kind}`);
}
