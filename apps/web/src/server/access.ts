// Who holds which seat.

import type { Actor } from "@mm/core/access";
import { authorize } from "./guard";
import { listPeople, type Person } from "./session";

export async function seats(actor: Actor): Promise<Person[]> {
  await authorize(actor, "access.view", { action: "read", resource: "access" });
  return listPeople();
}
