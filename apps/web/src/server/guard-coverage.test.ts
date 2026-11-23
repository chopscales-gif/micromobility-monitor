// "Every data access is in the audit log" is only true while every query goes through the guard.
// This reads the console's own source and fails when someone adds a query that does not: an exported
// function in this folder that runs SQL without calling authorize(), or a file outside this folder
// that reaches the database at all. The few that are left out on purpose are named here, with why.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVER = import.meta.dirname;
const SRC = join(SERVER, "..");

/** Queries that are not logged, and the reason each is not a read of someone else's data. */
const UNLOGGED: Record<string, string> = {
  "alerts.ts:unreadCount": "a person's own alerts, counted on every page for the bell",
  "alerts.ts:myAlerts": "a person's own alerts",
  "alerts.ts:openAlert": "marks one of a person's own alerts as read",
  "alerts.ts:markAllRead": "marks a person's own alerts as read",
  "open-data.ts:publicMonths": "the public page: no seat, and only figures already cleared for publication",
  "open-data.ts:openData": "the public page: no seat, and only figures already cleared for publication",
  "reports.ts:reportMonths": "the list of months on record, with no figures",
  "session.ts:listPeople": "the seat picker, which stands in for sign-in in this demonstration",
};
/** Guarded only when asked for more than the person's own: checked by name so the condition cannot be dropped quietly. */
const CONDITIONAL = { "alerts.ts:outbox": 'if (everyone) await authorize(actor, "outbox.view"' };

function exported(file: string): { name: string; body: string }[] {
  const source = readFileSync(join(SERVER, file), "utf8");
  return source
    .split(/^(?=export )/m)
    .map((body) => ({ name: /^export (?:async function|const) (\w+)(?: = cache\(async| = async|\()/.exec(body)?.[1], body }))
    .filter((part): part is { name: string; body: string } => part.name !== undefined);
}

const files = readdirSync(SERVER).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "guard.ts" && f !== "db.ts");

describe("the guard", () => {
  it("stands in front of every exported query", () => {
    const unguarded = files.flatMap((file) =>
      exported(file)
        .filter((fn) => fn.body.includes("sql`") && !fn.body.includes("authorize("))
        .map((fn) => `${file}:${fn.name}`),
    );
    expect(unguarded.sort()).toEqual(Object.keys(UNLOGGED).sort());
  });

  it("is still conditional only where that was decided", () => {
    for (const [key, line] of Object.entries(CONDITIONAL)) {
      const [file, name] = key.split(":") as [string, string];
      expect(exported(file).find((fn) => fn.name === name)?.body).toContain(line);
    }
  });

  it("finds queries to check, so a change in code style cannot empty this test", () => {
    const guarded = files.flatMap((file) => exported(file).filter((fn) => fn.body.includes("authorize(")));
    expect(guarded.length).toBeGreaterThan(30);
  });

  it("is the only way to the database: nothing outside the server folder connects to it", () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? (join(dir, name) === SERVER ? [] : walk(join(dir, name))) : [join(dir, name)]));
    const reaching = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /from "@\/server\/db"|from "@mm\/db"|from "postgres"/.test(readFileSync(f, "utf8")));
    expect(reaching).toEqual([]);
  });
});
