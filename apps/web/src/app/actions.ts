"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { resetDemonstration } from "@/server/demo";
import { listPeople, VIEW_AS_COOKIE } from "@/server/session";

/** Switches the demonstration's seat. */
export async function viewAs(formData: FormData) {
  const chosen = String(formData.get("person") ?? "");
  const people = await listPeople();
  if (!people.some((p) => p.userId === chosen)) return;
  (await cookies()).set(VIEW_AS_COOKIE, chosen, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/", "layout");
  // Each seat has its own home, and the page being looked at may not be one the new seat can open.
  redirect("/");
}

/** Puts the demonstration back as it was seeded, for everyone looking at it. */
export async function resetDemo() {
  await resetDemonstration();
  revalidatePath("/", "layout");
  redirect("/");
}
