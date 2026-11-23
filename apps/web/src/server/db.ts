import { clock } from "@mm/core/clock";
import { connect, type Sql } from "@mm/db";

// One pool per server process, kept across hot reloads in development.
const holder = globalThis as unknown as { mmSql?: Sql };

// On a host that runs the application as short-lived functions, DATABASE_POOL_MAX keeps each one to a few
// connections and DATABASE_IDLE_SECONDS hands them back when it goes quiet. Where the host offers both a
// pooled and a direct address, the direct one (DATABASE_URL_UNPOOLED) is used: the demonstration's reset
// holds a lock for the length of a session, which a pooler that shares sessions between requests would break.
const setting = (name: string) => (process.env[name] ? Number(process.env[name]) : undefined);

export const sql: Sql = (holder.mmSql ??= connect(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL, { max: setting("DATABASE_POOL_MAX") ?? 5, idleSeconds: setting("DATABASE_IDLE_SECONDS") }).sql);

/**
 * The present, for use inside a query in place of now(): the same moment the rest of the application
 * goes by, so a copy with its clock stopped (DEMO_CLOCK) counts its windows and stamps its records from there.
 */
export const sqlNow = () => sql`${new Date(clock())}::timestamptz`;
