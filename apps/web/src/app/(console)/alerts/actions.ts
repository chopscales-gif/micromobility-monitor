"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { markAllRead, openAlert } from "@/server/alerts";
import { currentPerson } from "@/server/session";

/** Opening an alert marks it read and goes to what it is about. */
export async function open(formData: FormData) {
  const href = await openAlert(await currentPerson(), String(formData.get("id") ?? ""));
  redirect(href && href.startsWith("/") ? href : "/alerts");
}

export async function readAll() {
  await markAllRead(await currentPerson());
  revalidatePath("/", "layout");
  redirect("/alerts");
}
