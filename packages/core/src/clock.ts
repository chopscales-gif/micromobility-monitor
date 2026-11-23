// The moment the application treats as the present.
//
// Normally that is the real time. A hosted demonstration that runs without the worker has nothing
// arriving, so its history ends where the seed stopped; left on the real clock, every screen would
// drift away from it (feeds silent for days, deadlines long past, empty months). DEMO_CLOCK stops
// the clock at one instant instead: the instant the database was seeded for. Seed with it set, and
// give the web application the same value. Never set it where the worker runs.

/** Reads DEMO_CLOCK as it was set: an ISO instant such as 2026-11-10T21:10:00Z. Null when unset. */
export function parseClock(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const at = Date.parse(raw.trim());
  if (Number.isNaN(at)) throw new Error("DEMO_CLOCK must be an ISO date and time, for example 2026-11-10T21:10:00Z");
  return at;
}

const stopped = parseClock(process.env.DEMO_CLOCK);

/** True when the clock is stopped, which is to say on a recorded copy with no live polling. */
export const clockStopped = stopped !== null;

/** Now, in milliseconds: the stopped instant when DEMO_CLOCK is set, the real time otherwise. */
export const clock = (): number => stopped ?? Date.now();
