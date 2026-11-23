import { connect, type Sql } from "@mm/db";

// One pool per server process, kept across hot reloads in development.
const holder = globalThis as unknown as { mmSql?: Sql };

export const sql: Sql = (holder.mmSql ??= connect(undefined, { max: 5 }).sql);
