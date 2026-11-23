"use server";

import { redirect } from "next/navigation";
import { issueInvoice, recalculateInvoice } from "@/server/fees";
import { Refused } from "@/server/guard";
import { currentPerson } from "@/server/session";

const back = (number: string, query: string): never => redirect(`/invoices/${encodeURIComponent(number)}?${query}`);

export async function recalculate(formData: FormData) {
  const number = String(formData.get("number") ?? "");
  let problem: string | null = null;
  try {
    problem = await recalculateInvoice(await currentPerson(), number);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back(number, "refused=1");
  }
  back(number, problem ? `problem=${encodeURIComponent(problem)}` : "recalculated=1");
}

export async function issue(formData: FormData) {
  const number = String(formData.get("number") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 600);
  let problem: string | null = null;
  try {
    problem = await issueInvoice(await currentPerson(), number, note);
  } catch (error) {
    if (!(error instanceof Refused)) throw error;
    back(number, "refused=1");
  }
  back(number, problem ? `problem=${encodeURIComponent(problem)}` : "issued=1");
}
