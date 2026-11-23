import { redirect } from "next/navigation";

/** Findings are worked inside their cases now. Old links to the queue land on the cases. */
export default async function ViolationsPage({ searchParams }: { searchParams: Promise<{ rule?: string; operator?: string }> }) {
  const { rule, operator } = await searchParams;
  const query = new URLSearchParams();
  if (rule) query.set("rule", rule);
  if (operator) query.set("operator", operator);
  const text = query.toString();
  redirect(text ? `/cases?${text}` : "/cases");
}
