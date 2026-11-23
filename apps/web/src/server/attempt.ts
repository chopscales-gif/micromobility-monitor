import { Refused } from "./guard";

/** Runs a guarded query; a refusal comes back as a value so the page can show it instead of crashing. */
export async function attempt<T>(run: () => Promise<T>): Promise<T | Refused> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refused) return error;
    throw error;
  }
}
