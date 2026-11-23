// The one door to the data. Every query names the permission it needs and what it
// is reading; the attempt is written to the audit log whether or not it is allowed.

import { can, maySeeOperator, operatorScope, type Actor, type Permission } from "@mm/core/access";
import { sql, sqlNow } from "./db";

export class Refused extends Error {
  constructor(public permission: Permission) {
    super(`Not permitted: ${permission}`);
  }
}

type Access = {
  /** read | export | change */
  action: "read" | "export" | "change";
  /** What is being read, e.g. "live_map", "invoice". */
  resource: string;
  /** The operator whose data this is, when it belongs to one. */
  operatorId?: string | null;
  detail?: Record<string, unknown>;
  /** For screens that refresh themselves: repeat reads within ten minutes are counted on one row. */
  repeating?: boolean;
  /** The actor holds the permission, but this particular record is kept from them: recorded as refused, answered as "not found". */
  withheld?: boolean;
};

/**
 * Checks the permission, records the access, and returns the operator the actor is
 * confined to (null for city staff, who see every operator).
 */
export async function authorize(actor: Actor, permission: Permission, access: Access): Promise<string | null> {
  const permitted = can(actor.role, permission) && (access.operatorId == null || maySeeOperator(actor, access.operatorId));
  const allowed = permitted && !access.withheld;
  const scope = actor.role === "operator" ? actor.operatorId : null;
  const operatorId = access.operatorId ?? scope;

  if (allowed && access.repeating) {
    const updated = await sql`
      update audit_log set detail = jsonb_set(coalesce(detail, '{}'), '{reads}', to_jsonb(coalesce((detail->>'reads')::int, 1) + 1)) || jsonb_build_object('last_read', ${sqlNow()})
      where id = (select id from audit_log where user_id = ${actor.userId} and action = ${access.action} and resource = ${access.resource}
        and allowed and at > ${sqlNow()} - interval '10 minutes' and detail ? 'reads' order by id desc limit 1)
      returning id`;
    if (updated.length > 0) return operatorScope(actor);
  }
  const detail = access.repeating ? { ...access.detail, reads: 1 } : (access.detail ?? null);
  await sql`insert into audit_log (at, user_id, user_name, role, action, resource, operator_id, allowed, detail)
    values (${sqlNow()}, ${actor.userId}, ${actor.name}, ${actor.role}, ${access.action}, ${access.resource}, ${operatorId ?? null}, ${allowed}, ${detail === null ? null : sql.json(detail as never)})`;

  if (!permitted) throw new Refused(permission);
  return operatorScope(actor);
}
