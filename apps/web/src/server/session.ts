// Who is looking. In this demonstration the signed-in person is chosen with the
// seat picker at the top of the page and remembered in a cookie; in production this function is
// the one place that would read an OpenID Connect session instead. Everything
// downstream (permissions, operator scoping, the audit log) only sees an Actor.

import type { Actor, Role } from "@mm/core/access";
import { cookies } from "next/headers";
import { cache } from "react";
import { sql } from "./db";

export const VIEW_AS_COOKIE = "mm_view_as";

export type Person = Actor & { title: string; email: string; operatorName: string | null };

export const listPeople = cache(async (): Promise<Person[]> => {
  const rows = await sql`
    select u.id, u.name, u.email, u.title, u.role, u.operator_id, o.name as operator_name
    from users u left join operators o on o.id = u.operator_id
    order by array_position(array['analyst', 'program_manager', 'finance', 'admin', 'read_only', 'operator'], u.role), u.name`;
  return rows.map((r) => ({ userId: r.id, name: r.name, email: r.email, title: r.title, role: r.role as Role, operatorId: r.operator_id, operatorName: r.operator_name }));
});

export const currentPerson = cache(async (): Promise<Person> => {
  const people = await listPeople();
  if (people.length === 0) throw new Error("The database has no users. Run `npm run db:seed`.");
  const chosen = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  return people.find((p) => p.userId === chosen) ?? people[0]!;
});
