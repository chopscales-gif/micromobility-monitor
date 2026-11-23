// The demonstration's reset. Visitors to a hosted copy share one database, so what one of them
// changes the next would find. With DEMO_RESET set, everything is put back each night (by the worker,
// or where there is none by a scheduled request to /api/cron/reset) and the strip at the top of the
// console offers the same on request. Without it, none of this exists.

import { clock } from "@mm/core/clock";
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
export async function resetDemonstration(): Promise<"done" | "off" | "recent" | "running"> {
  if (!demoResetEnabled()) return "off";
  // The pause is counted on the real clock; the demonstration is rebuilt as of its own, which may be stopped.
  const pressed = Date.now();
  if (holder.mmLastReset !== undefined && pressed - holder.mmLastReset < PAUSE_MS) return "recent";
  holder.mmLastReset = pressed;
  return (await resetDemo(sql, clock())) ? "done" : "running";
}

/** The nightly reset, for a host with no worker: the same work, without the pause that guards the button. */
export async function scheduledReset(): Promise<"done" | "off" | "running"> {
  if (!demoResetEnabled()) return "off";
  return (await resetDemo(sql, clock())) ? "done" : "running";
}
