// The demonstration's reset. Visitors to a hosted copy share one database, so what one of them
// changes the next would find. With DEMO_RESET set, the worker puts everything back each night and
// the strip at the top of the console offers the same on request. Without it, none of this exists.

import { resetDemo } from "@mm/ingest";
import { sql } from "./db";

/** One reset serves everyone looking; a second inside this long would only interrupt them again. */
const PAUSE_MS = 60_000;
const holder = globalThis as unknown as { mmLastReset?: number };

export const demoResetEnabled = (): boolean => Boolean(process.env.DEMO_RESET);

/**
 * Puts the demonstration back as it was seeded. Open to every seat, because it is a control of the
 * demonstration and not of the product, and unlogged, because the audit log is among what it clears.
 */
export async function resetDemonstration(now = Date.now()): Promise<"done" | "off" | "recent" | "running"> {
  if (!demoResetEnabled()) return "off";
  if (holder.mmLastReset !== undefined && now - holder.mmLastReset < PAUSE_MS) return "recent";
  holder.mmLastReset = now;
  return (await resetDemo(sql, now)) ? "done" : "running";
}
